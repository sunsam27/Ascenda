// ─────────────────────────────────────────────────────────────────────────────
// ASCENDA API — Entry Point
// ─────────────────────────────────────────────────────────────────────────────
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('API_PORT', 3001);
  const prefix = config.get<string>('API_PREFIX', 'api/v1');
  const corsOrigin = config.get<string>('CORS_ORIGIN', 'http://localhost:3000');

  // ── Security headers ────────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  // ── CORS — only allow the web app origin ────────────────────────────────────
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Organisation-Id'],
  });

  // ── Global prefix ───────────────────────────────────────────────────────────
  app.setGlobalPrefix(prefix);

  // ── Global validation pipe — explicit allow-lists prevent mass assignment ───
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,          // Strip unknown fields (mass-assignment defense)
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // ── Swagger (dev only) ──────────────────────────────────────────────────────
  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Ascenda API')
      .setDescription('People, payroll and workforce intelligence platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    Logger.log('Swagger docs available at /api/docs', 'Bootstrap');
  }

  await app.listen(port);
  Logger.log(`Ascenda API running on port ${port}`, 'Bootstrap');
  Logger.log(`Prefix: /${prefix}`, 'Bootstrap');
}

void bootstrap();
