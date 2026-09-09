import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origins = (process.env.DESKTOP_ORIGIN ?? 'tauri://localhost,http://tauri.localhost,http://localhost:1420').split(',');
  app.enableCors({ origin: origins });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('v1', { exclude: ['health', 'internal/cron/catalog-sync'] });

  const openApi = new DocumentBuilder()
    .setTitle('Siilvana Catalog API')
    .setDescription('开发环境目录、推荐与安装计划 API')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, openApi));

  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();

