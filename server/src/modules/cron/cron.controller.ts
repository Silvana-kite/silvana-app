import { HistoryService } from '../releases/history.service.js';
import { HistoryOperations } from '../releases/ops.controller.js';
import { readFile } from 'node:fs/promises';
import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { ReleasesService } from '../releases/releases.service.js';

@Controller('internal/cron')
export class CatalogCronController {
  constructor(private readonly service: ReleasesService, private readonly history: HistoryService, private readonly operations: HistoryOperations) {}

  @Get('catalog-sync')
  async sync(@Headers('authorization') authorization?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret || authorization !== `Bearer ${secret}`) throw new UnauthorizedException();
    const result = await this.service.sync();
    if (process.env.HISTORY_SIGNING_KEY_FILE) process.env.HISTORY_SIGNING_KEY = await readFile(process.env.HISTORY_SIGNING_KEY_FILE, 'utf8');
    if (process.env.HISTORY_SIGNING_KEY) await this.history.publish();
    await this.operations.evaluate(); return result;
  }
}
