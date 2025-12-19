import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { CookieJwtAuthGuard } from './guards/cookie-jwt-auth.guard';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '1h' },
    }),
    RedisModule,
  ],
  providers: [JwtStrategy, RolesGuard, CookieJwtAuthGuard],
  exports: [JwtModule, RolesGuard, CookieJwtAuthGuard],
})
export class AuthModule {}





















