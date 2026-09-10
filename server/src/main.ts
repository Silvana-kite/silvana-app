import { migrate } from './infrastructure/database/migrate.js';
import 'reflect-metadata';
import './infrastructure/source-tls.js';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  if (process.env.AUTO_MIGRATE === '1') await migrate();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const limits = new Map<string, { count: number; until: number }>();
  app.use((request: import('express').Request, response: import('express').Response, next: () => void) => {
    const key = `${request.ip}:${request.path.startsWith('/ops') ? 'ops' : 'public'}`; const now = Date.now();
    if (limits.size > 10000) for (const [key, value] of limits) if (value.until < now) limits.delete(key);
    const entry = limits.get(key); const current = entry && entry.until > now ? entry : { count: 0, until: now + 60000 };
    current.count++; limits.set(key, current);
    if (current.count > (request.path.startsWith('/ops') ? 60 : 120)) { response.setHeader('Retry-After', '60'); response.status(429).json({ message: 'Rate limit exceeded' }); return; } next();
  });
  const origins = (process.env.DESKTOP_ORIGIN ?? 'tauri://localhost,http://tauri.localhost,http://localhost:1420').split(',');
  app.enableCors({ origin: origins, exposedHeaders: ['ETag'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('v1', { exclude: ['health', 'health/{*path}', 'internal/cron/catalog-sync', 'v2/{*path}', 'ops/{*path}'] });

  const openApi = new DocumentBuilder()
    .setTitle('Siilvana Catalog API')
    .setDescription('开发环境目录、推荐与安装计划 API')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, openApi));

  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
