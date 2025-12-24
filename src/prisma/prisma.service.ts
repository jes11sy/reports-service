import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    // ✅ ОПТИМИЗИРОВАНО: Reports Service - тяжелые аналитические запросы
    // Агрегации, JOIN'ы, долгие вычисления - требуется высокий connection pool
    const databaseUrl = process.env.DATABASE_URL || '';
    const hasParams = databaseUrl.includes('?');
    
    const connectionParams = [
      'connection_limit=50',      // Высокое значение для аналитики
      'pool_timeout=30',          // Увеличен timeout для долгих запросов
      'connect_timeout=10',       // Таймаут подключения к БД: 10s
      'socket_timeout=120',       // Увеличен socket timeout для тяжелых запросов
      // ✅ FIX: TCP Keepalive для предотвращения idle-session timeout
      'keepalives=1',
      'keepalives_idle=30',
      'keepalives_interval=10',
      'keepalives_count=3',
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
      this.logger.log('✅ Connection pool configured: limit=50, pool_timeout=30s, socket_timeout=120s');
    }

    // Query Performance Monitoring - более высокие пороги для reports
    this.$use(async (params, next) => {
      const before = Date.now();
      
      try {
        const result = await next(params);
        const duration = Date.now() - before;

        // Reports могут выполняться дольше - более мягкие пороги
        if (duration > 5000) {
          this.logger.error(`🐌 VERY SLOW QUERY: ${params.model}.${params.action} took ${duration}ms`);
        } else if (duration > 2000) {
          this.logger.warn(`⚠️ Slow query: ${params.model}.${params.action} took ${duration}ms`);
        } else if (duration > 1000) {
          this.logger.log(`ℹ️ Long query: ${params.model}.${params.action} took ${duration}ms`);
        }

        return result;
      } catch (error) {
        const duration = Date.now() - before;
        this.logger.error(`❌ Query failed after ${duration}ms`, error);
        throw error;
      }
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('✅ Database connected successfully');
      this.logger.log('✅ Reports Service ready (analytics configuration)');
    } catch (error) {
      this.logger.error('❌ Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('✅ Database disconnected');
  }
}





















