import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CatalogCronController } from './cron.controller.js';
import { ReleasesModule } from '../releases/releases.module.js';

@Module({ imports: [CatalogModule, ReleasesModule], controllers: [CatalogCronController] })
export class CronModule {}
