import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private isReady: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;

  // ✅ Оптимизировано: интервал keepalive увеличен до 30 секунд
  private readonly KEEPALIVE_INTERVAL_MS = 30000;

  constructor() {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    // Reports Service - тяжелые аналитические запросы
    const databaseUrl = process.env.DATABASE_URL || '';
    const hasParams = databaseUrl.includes('?');
    
    // Настройки для предотвращения 502
    const connectionParams = [
      'connection_limit=50',
      'pool_timeout=45',
      'connect_timeout=15',
      'socket_timeout=180',
      'keepalives=1',
      'keepalives_idle=30',      // Увеличено с 15 до 30
      'keepalives_interval=10',  // Увеличено с 5 до 10
      'keepalives_count=3',      // Уменьшено с 5 до 3
    ];
    
    const needsParams = !databaseUrl.includes('connection_limit');
    const enhancedUrl = needsParams
      ? `${databaseUrl}${hasParams ? '&' : '?'}${connectionParams.join('&')}`
      : databaseUrl;

    super({
      datasources: {
        db: {
          url: enhancedUrl,
        },
      },
      log: isDevelopment 
        ? ['warn', 'error']
        : ['error'],
    });

    if (needsParams) {
      this.logger.log('✅ Connection pool configured: limit=50, pool_timeout=45s');
    }

    // Query Performance Monitoring
    this.$use(async (params, next) => {
      const before = Date.now();
      
      try {
        const result = await next(params);
        const duration = Date.now() - before;

        // Reports могут выполняться дольше - мягкие пороги
        if (duration > 5000) {
          this.logger.error(`🐌 VERY SLOW QUERY: ${params.model}.${params.action} took ${duration}ms`);
        } else if (duration > 2000) {
          this.logger.warn(`⚠️ Slow query: ${params.model}.${params.action} took ${duration}ms`);
        } else if (isDevelopment && duration > 1000) {
          this.logger.debug(`ℹ️ Long query: ${params.model}.${params.action} took ${duration}ms`);
        }

        return result;
      } catch (error) {
        const duration = Date.now() - before;
        this.logger.error(`❌ Query failed after ${duration}ms`, error);
        throw error;
      }
    });
  }

  /**
   * Выполнить запрос с автоматическим переподключением при stale connection
   */
  async executeWithRetry<T>(operation: () => Promise<T>, maxRetries = 2): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        const isConnectionError = 
          error.code === 'P1001' ||
          error.code === 'P1002' ||
          error.code === 'P1008' ||
          error.code === 'P1017' ||
          error.code === 'P2024' ||
          error.message?.includes('Connection') ||
          error.message?.includes('ECONNRESET') ||
          error.message?.includes('ETIMEDOUT') ||
          error.message?.includes('socket hang up');
        
        if (isConnectionError && attempt < maxRetries) {
          this.logger.warn(`⚠️ Connection error on attempt ${attempt + 1}, reconnecting...`);
          
          try {
            await this.$disconnect();
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            await this.$connect();
            this.logger.log('✅ Reconnected to database');
            await this.$queryRaw`SELECT 1`;
            continue;
          } catch (reconnectError: any) {
            this.logger.error(`❌ Reconnect failed: ${reconnectError.message}`);
          }
        }
        
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * Проверка готовности сервиса
   */
  async checkHealth(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - start;
      this.isReady = true;
      return { healthy: true, latencyMs };
    } catch (error) {
      this.isReady = false;
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  /**
   * Быстрая проверка готовности (без запроса к БД)
   */
  isHealthy(): boolean {
    return this.isReady;
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('✅ Database connected successfully');
      
      // Прогрев соединения
      try {
        const warmupStart = Date.now();
        await this.$queryRaw`SELECT 1`;
        const warmupTime = Date.now() - warmupStart;
        this.logger.log(`✅ Database warmup completed in ${warmupTime}ms`);
        this.isReady = true;
      } catch (warmupError: any) {
        this.logger.warn(`⚠️ Database warmup partial: ${warmupError?.message}`);
        this.isReady = true;
      }
      
      // ✅ Оптимизировано: Keepalive каждые 30 секунд (вместо 15)
      // Это уменьшает нагрузку на БД, сохраняя защиту от stale connections
      this.keepAliveInterval = setInterval(async () => {
        try {
          await this.$queryRaw`SELECT 1`;
          this.reconnectAttempts = 0;
        } catch (error: any) {
          this.logger.warn(`⚠️ Keepalive ping failed: ${error?.message}`);
          this.reconnectAttempts++;
          
          if (this.reconnectAttempts <= this.MAX_RECONNECT_ATTEMPTS) {
            try {
              this.logger.log(`🔄 Attempting reconnect (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`);
              await this.$disconnect();
              await new Promise(resolve => setTimeout(resolve, 1000));
              await this.$connect();
              await this.$queryRaw`SELECT 1`;
              this.logger.log('✅ Reconnected successfully');
              this.isReady = true;
              this.reconnectAttempts = 0;
            } catch (reconnectError: any) {
              this.logger.error(`❌ Reconnect failed: ${reconnectError?.message}`);
              this.isReady = false;
            }
          } else {
            this.isReady = false;
          }
        }
      }, this.KEEPALIVE_INTERVAL_MS);
      
      this.logger.log(`✅ Reports Service ready (keepalive interval: ${this.KEEPALIVE_INTERVAL_MS}ms)`);
    } catch (error) {
      this.logger.error('❌ Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    await this.$disconnect();
    this.logger.log('✅ Database disconnected');
  }
}
