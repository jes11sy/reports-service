import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: any = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message || message;
        details = (exceptionResponse as any).details;
      }
    }

    // Логируем детали только на сервере
    this.logger.error(
      `[${request.method}] ${request.url} - Status: ${status}`,
      {
        error: exception instanceof Error ? exception.message : exception,
        stack: exception instanceof Error ? exception.stack : undefined,
        user: request.user?.login || 'anonymous',
        ip: request.ip,
      }
    );

    // Клиенту отправляем безопасное сообщение
    const errorResponse = {
      statusCode: status,
      message: status === 500 ? 'Internal server error' : message,
      timestamp: new Date().toISOString(),
      path: request.url,
      // Детали только для не-production
      ...(process.env.NODE_ENV !== 'production' && details ? { details } : {}),
    };

    response.status(status).send(errorResponse);
  }
}

