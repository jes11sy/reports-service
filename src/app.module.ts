import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import type { RedisClientOptions } from 'redis';
import { redisStore } from 'cache-manager-redis-yet';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ReportsModule } from './reports/reports.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // ✅ Redis кеширование для аналитики
    CacheModule.registerAsync<RedisClientOptions>({
      isGlobal: true,
      useFactory: async () => {
        const redisHost = process.env.REDIS_HOST || 'localhost';
        const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
        const redisPassword = process.env.REDIS_PASSWORD;
        
        try {
          const store = await redisStore({
            socket: {
              host: redisHost,
              port: redisPort,
            },
            password: redisPassword,
          });
          
          console.log(`✅ Redis cache connected: ${redisHost}:${redisPort}`);
          return { 
            store,
            ttl: 60000,
          } as any;
        } catch (error: any) {
          console.warn('⚠️ Redis unavailable, using in-memory cache');
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
})
export class AppModule {}



