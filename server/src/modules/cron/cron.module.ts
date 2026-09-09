import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CatalogCronController } from './cron.controller.js';

@Module({ imports: [CatalogModule], controllers: [CatalogCronController] })
export class CronModule {}
