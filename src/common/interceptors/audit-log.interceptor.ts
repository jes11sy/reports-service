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
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditLog');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user, ip } = request;

    // Логируем только важные операции
    const shouldAudit = this.shouldAuditRequest(method, url);

    if (shouldAudit) {
      this.logger.log({
        event: 'API_ACCESS',
        method,
        url,
        user: user?.login || 'anonymous',
        userId: user?.userId,
        role: user?.role,
        ip,
        timestamp: new Date().toISOString(),
      });
    }

    return next.handle().pipe(
      tap({
        error: (error) => {
          if (shouldAudit) {
            this.logger.warn({
              event: 'API_ACCESS_FAILED',
              method,
              url,
              user: user?.login || 'anonymous',
              userId: user?.userId,
              error: error.message,
              timestamp: new Date().toISOString(),
            });
          }
        },
      })
    );
  }

  private shouldAuditRequest(method: string, url: string): boolean {
    // Аудит для операций изменения данных или доступа к чувствительной информации
    const auditPaths = ['/api/v1/analytics', '/api/v1/reports/finance'];
    return auditPaths.some(path => url.startsWith(path)) || method !== 'GET';
  }
}

