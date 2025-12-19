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
      const redisHost = process.env.REDIS_HOST || 'localhost';
      const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
      const redisPassword = process.env.REDIS_PASSWORD;

      this.client = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword,
        retryStrategy: (times) => {
          if (times > 3) {
            return null; // Stop retrying
          }
          return Math.min(times * 200, 1000);
        },
        lazyConnect: true,
      });

      await this.client.connect();
      this.isAvailable = true;
      this.logger.log(`✅ Redis connected for force_logout checks: ${redisHost}:${redisPort}`);
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
   * Graceful degradation: если Redis недоступен, возвращаем false (не блокируем пользователя)
   */
  async isUserForcedLogout(userId: number, role: string): Promise<boolean> {
    if (!this.isAvailable || !this.client) {
      return false; // Graceful degradation
    }

    try {
      const forceLogoutKey = `force_logout:${role}:${userId}`;
      const result = await this.client.get(forceLogoutKey);
      return result === '1';
    } catch (error: any) {
      this.logger.warn(`Force logout check failed: ${error.message}`);
      return false; // Graceful degradation
    }
  }
}

