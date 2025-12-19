import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CookieConfig } from '../../config/cookie.config';

/**
 * Guard для поддержки JWT токенов из cookies
 * Расширяет стандартный JwtAuthGuard, добавляя поддержку извлечения токенов из httpOnly cookies
 * 
 * Приоритет извлечения токена:
 * 1. Authorization header (Bearer token) - для обратной совместимости
 * 2. Cookie access_token - новый способ (httpOnly)
 */
@Injectable()
export class CookieJwtAuthGuard extends JwtAuthGuard {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const rawRequest = request.raw as any;
    
    // Пытаемся найти cookies в разных местах
    const cookies = rawRequest.cookies || (request as any).cookies || null;
    const unsignCookie = rawRequest.unsignCookie || (request as any).unsignCookie || null;
    
    console.log('🔍 DEBUG: rawRequest.cookies =', !!rawRequest.cookies);
    console.log('🔍 DEBUG: request.cookies =', !!(request as any).cookies);
    console.log('🔍 DEBUG: Found cookies =', !!cookies);
    console.log('🔍 DEBUG: Cookie keys =', cookies ? Object.keys(cookies) : 'NONE');
    console.log('🔍 DEBUG: Has unsignCookie =', !!unsignCookie);
    
    // ✅ Читаем cookies из найденного источника
    let cookieToken = null;
    
    if (cookies && CookieConfig.ENABLE_COOKIE_SIGNING && unsignCookie) {
      // Пытаемся получить подписанный cookie (защита от tampering)
      const signedCookie = cookies[CookieConfig.ACCESS_TOKEN_NAME];
      console.log('🔍 Signed cookie:', signedCookie ? 'exists' : 'not found');
      
      if (signedCookie) {
        const unsigned = unsignCookie(signedCookie);
        console.log('🔍 Unsigned result:', { valid: unsigned?.valid, hasValue: !!unsigned?.value });
        cookieToken = unsigned?.valid ? unsigned.value : null;
        
        // Если подпись не валидна
        if (unsigned && !unsigned.valid) {
          throw new UnauthorizedException('Invalid cookie signature detected. Possible tampering attempt.');
        }
      }
    } else if (cookies) {
      // Fallback на обычные cookies если signing отключен
      cookieToken = cookies[CookieConfig.ACCESS_TOKEN_NAME];
      console.log('🔍 Cookie without signing:', cookieToken ? 'found' : 'not found');
    }
    
    console.log('🔍 Cookie token:', cookieToken ? 'extracted' : 'not found');
    console.log('🔍 Has Authorization header:', !!request.headers.authorization);
    
    // Если токен в cookie есть и нет Authorization header - используем cookie
    if (cookieToken && !request.headers.authorization) {
      // Добавляем токен из cookie в заголовок для JWT strategy
      request.headers.authorization = `Bearer ${cookieToken}`;
      console.log('✅ Token added to Authorization header');
    }
    
    // Вызываем родительский guard для валидации токена
    return super.canActivate(context);
  }
  
  /**
   * Обработка ошибок с понятными сообщениями
   */
  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Access token has expired. Please refresh your token.');
      }
      if (info?.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('Invalid access token.');
      }
      throw err || new UnauthorizedException('Authentication required.');
    }
    return user;
  }
}

