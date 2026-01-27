import { Module, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

// ✅ FIX #117: Используем Logger вместо console.log
const cacheLogger = new Logger('CacheModule');
import type { RedisClientOptions } from 'redis';
import { redisStore } from 'cache-manager-redis-yet';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ReportsModule } from './reports/reports.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { StatsModule } from './stats/stats.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    
    // ✅ Rate Limiting - защита от DDoS
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,      // 1 секунда
        limit: 10,      // 10 запросов в секунду
      },
      {
        name: 'medium',
        ttl: 10000,     // 10 секунд
        limit: 50,      // 50 запросов за 10 секунд
      },
      {
        name: 'long',
        ttl: 60000,     // 1 минута
        limit: 100,     // 100 запросов в минуту
      },
    ]),
    
    RedisModule,
    
    // ✅ Redis кеширование для аналитики (с поддержкой Sentinel)
    CacheModule.registerAsync<RedisClientOptions>({
      isGlobal: true,
      useFactory: async () => {
        const redisMode = process.env.REDIS_MODE || 'standalone';
        const redisPassword = process.env.REDIS_PASSWORD;
        
        try {
          let storeConfig: any;
          
          if (redisMode === 'sentinel') {
            const sentinelHost = process.env.REDIS_SENTINEL_HOST || 'redis-sentinel';
            const sentinelPort = parseInt(process.env.REDIS_SENTINEL_PORT || '26379', 10);
            const sentinelName = process.env.REDIS_SENTINEL_NAME || 'mymaster';
            
            cacheLogger.log(`🔄 Redis cache connecting via Sentinel: ${sentinelHost}:${sentinelPort}`);
            
            storeConfig = {
              sentinel: {
                rootNodes: [{ host: sentinelHost, port: sentinelPort }],
                name: sentinelName,
              },
              password: redisPassword,
            };
          } else {
            const redisHost = process.env.REDIS_HOST || 'localhost';
            const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
            
            cacheLogger.log(`🔄 Redis cache connecting standalone: ${redisHost}:${redisPort}`);
            
            storeConfig = {
              socket: {
                host: redisHost,
                port: redisPort,
              },
              password: redisPassword,
            };
          }
          
          const store = await redisStore(storeConfig);
          
          cacheLogger.log(`✅ Redis cache connected (${redisMode} mode)`);
          return { 
            store,
            ttl: 60000,
          } as any;
        } catch (error: any) {
          cacheLogger.warn('⚠️ Redis unavailable, using in-memory cache');
          return {
            ttl: 60000,
            max: 100,
          } as any;
        }
      },
    }),
    
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
      path: '/metrics',
    }),
    
    PrismaModule,
    AuthModule,
    ReportsModule,
    AnalyticsModule,
    StatsModule,
  ],
  providers: [
    // ✅ Глобальный Rate Limiter
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
