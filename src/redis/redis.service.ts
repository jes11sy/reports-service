import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Простой Redis Service для проверки force_logout флагов
 * Используется только для проверки принудительной деавторизации
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isAvailable = false;

  async onModuleInit() {
    try {
      // ✅ FIX: Поддержка Redis Sentinel для High Availability
      const redisMode = process.env.REDIS_MODE || 'standalone';
      const redisPassword = process.env.REDIS_PASSWORD;
      
      const commonOptions = {
        password: redisPassword,
        retryStrategy: (times: number) => {
          if (times > 3) {
            return null;
          }
          return Math.min(times * 200, 1000);
        },
        lazyConnect: true,
      };

      if (redisMode === 'sentinel') {
        const sentinelHost = process.env.REDIS_SENTINEL_HOST || 'redis-sentinel';
        const sentinelPort = parseInt(process.env.REDIS_SENTINEL_PORT || '26379', 10);
        const sentinelName = process.env.REDIS_SENTINEL_NAME || 'mymaster';
        
        this.logger.log(`🔄 Connecting to Redis via Sentinel: ${sentinelHost}:${sentinelPort}`);
        
        this.client = new Redis({
          sentinels: [{ host: sentinelHost, port: sentinelPort }],
          name: sentinelName,
          sentinelPassword: redisPassword,
          ...commonOptions,
        });
      } else {
        const redisHost = process.env.REDIS_HOST || 'localhost';
        const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
        
        this.logger.log(`🔄 Connecting to Redis standalone: ${redisHost}:${redisPort}`);
        
        this.client = new Redis({
          host: redisHost,
          port: redisPort,
          ...commonOptions,
        });
      }

      await this.client.connect();
      this.isAvailable = true;
      this.logger.log(`✅ Redis connected for force_logout checks`);
    } catch (error: any) {
      this.logger.warn(`⚠️ Redis unavailable for force_logout checks: ${error.message}`);
      this.isAvailable = false;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis disconnected');
    }
  }

  /**
   * Проверить флаг принудительной деавторизации
   * 
   * БЕЗОПАСНОСТЬ: Поведение при недоступности Redis настраивается через
   * REDIS_UNAVAILABLE_BLOCK_USER environment variable:
   * - 'true' (рекомендуется для production): блокировать пользователя при недоступности Redis
   * - 'false' (по умолчанию): graceful degradation - не блокировать
   * 
   * При недоступности Redis всегда логируется WARNING для мониторинга.
   */
  async isUserForcedLogout(userId: number, role: string): Promise<boolean> {
    // Определяем поведение при недоступности Redis
    const blockOnRedisUnavailable = process.env.REDIS_UNAVAILABLE_BLOCK_USER === 'true';
    
    if (!this.isAvailable || !this.client) {
      this.logger.warn(
        `⚠️ SECURITY: Redis unavailable for force_logout check. ` +
        `User: ${userId}, Role: ${role}. ` +
        `Action: ${blockOnRedisUnavailable ? 'BLOCKING user' : 'ALLOWING user (graceful degradation)'}`
      );
      return blockOnRedisUnavailable; // Configurable behavior
    }

    try {
      const forceLogoutKey = `force_logout:${role}:${userId}`;
      const result = await this.client.get(forceLogoutKey);
      return result === '1';
    } catch (error: any) {
      this.logger.warn(
        `⚠️ SECURITY: Force logout check failed: ${error.message}. ` +
        `User: ${userId}, Role: ${role}. ` +
        `Action: ${blockOnRedisUnavailable ? 'BLOCKING user' : 'ALLOWING user (graceful degradation)'}`
      );
      return blockOnRedisUnavailable; // Configurable behavior
    }
  }
}

