import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly prisma: PrismaService) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorMessage =
      exception instanceof HttpException
        ? exception.message
        : exception instanceof Error
        ? exception.message
        : 'Unknown error';

    const errorType =
      exception instanceof Error ? exception.constructor.name : 'UnknownError';

    const stackTrace =
      exception instanceof Error ? exception.stack : undefined;

    if (status >= 500) {
      try {
        await this.prisma.errorLog.create({
          data: {
            service: 'reports-service',
            errorType,
            errorMessage,
            stackTrace,
            userId: (request as any).user?.userId || null,
            userRole: (request as any).user?.role || null,
            requestUrl: request.url,
            requestMethod: request.method,
            ip: request.ip || (request.headers['x-forwarded-for'] as string) || null,
            userAgent: request.headers['user-agent'] || null,
            metadata: {
              body: request.body,
              params: request.params,
              query: request.query,
            },
          },
        });
      } catch (dbError) {
        this.logger.error(`🔥 Failed to write error log to DB`, dbError);
      }
    }

    this.logger.error(
      `[reports-service] ${request.method} ${request.url} - ${status} ${errorMessage}`,
      stackTrace,
    );

    response.status(status).json({
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: errorMessage,
    });
  }
}

