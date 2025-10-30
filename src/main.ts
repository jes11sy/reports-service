import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';

async function bootstrap() {
  // Проверка критичных переменных окружения
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable must be defined');
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable must be defined');
  }

  // HTTPS enforcement в production
  if (process.env.NODE_ENV === 'production' && !process.env.DISABLE_HTTPS_CHECK) {
    const logger = new Logger('Bootstrap');
    logger.warn('⚠️  Ensure HTTPS is enabled in production environment');
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ 
      logger: false, 
      trustProxy: true,
      bodyLimit: 10485760, // 10MB limit
    }),
  );

  const logger = new Logger('ReportsService');

  // CORS configuration - строгий в production
  const corsOrigin = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : (process.env.NODE_ENV === 'production' 
        ? [] 
        : ['http://localhost:3000', 'http://localhost:5173']);

  await app.register(require('@fastify/cors'), {
    origin: corsOrigin.length > 0 ? corsOrigin : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Helmet с правильной CSP
  await app.register(require('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // Компрессия ответов
  await app.register(require('@fastify/compress'), { 
    global: true,
    threshold: 1024, // Сжимать ответы > 1KB
  });

  // Глобальные обработчики
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new AuditLogInterceptor(),
  );

  // Validation pipe с строгими настройками
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  // Swagger только в non-production
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Reports Service API')
      .setDescription('Reports and analytics microservice')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    
    logger.log('📚 Swagger UI available at /api/docs');
  }

  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 5007;
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 Reports Service running on http://localhost:${port}`);
  logger.log(`🔒 Security features: CORS, Helmet, Compression enabled`);
  logger.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
}

bootstrap();





















