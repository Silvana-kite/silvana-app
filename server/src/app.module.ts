import { Module } from '@nestjs/common';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { CronModule } from './modules/cron/cron.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';

@Module({
  imports: [DatabaseModule, CatalogModule, HealthModule, CronModule],
})
export class AppModule {}
