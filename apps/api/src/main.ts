import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import * as Sentry from '@sentry/nestjs';
import { AppModule } from './app/app.module';
import { RequestLoggerInterceptor } from './app/common';

async function bootstrap() {
  // Initialize Sentry (free tier: 5k errors/month, performance monitoring)
  if (process.env['SENTRY_DSN']) {
    Sentry.init({
      dsn: process.env['SENTRY_DSN'],
      environment: process.env['NODE_ENV'] || 'development',
      tracesSampleRate: 0.2, // Sample 20% of transactions for performance
      profilesSampleRate: 0.1,
    });
  }

  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  // Global request logger
  app.useGlobalInterceptors(new RequestLoggerInterceptor());

  // OpenAPI + Scalar
  const config = new DocumentBuilder()
    .setTitle('Hearby API')
    .setDescription('POI discovery and Wikipedia TTS service')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-Hearby-API-Key', in: 'header' }, 'api-key')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  app.use(
    '/docs',
    apiReference({
      spec: { content: document },
      theme: 'purple',
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
  Logger.log(`📖 Scalar docs at: http://localhost:${port}/docs`);
}

bootstrap();
