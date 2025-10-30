import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user } = request;
    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - now;
          // Логируем только если запрос занял больше 1 секунды
          if (duration > 1000) {
            this.logger.warn(
              `Slow request: ${method} ${url} - ${duration}ms - User: ${user?.login || 'anonymous'}`
            );
          }
        },
        error: (error) => {
          const duration = Date.now() - now;
          this.logger.error(
            `Failed request: ${method} ${url} - ${duration}ms - User: ${user?.login || 'anonymous'}`,
            error.stack
          );
        },
      })
    );
  }
}

