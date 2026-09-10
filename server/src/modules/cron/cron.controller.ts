import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { ReleasesService } from '../releases/releases.service.js';

@Controller('internal/cron')
export class CatalogCronController {
  constructor(private readonly service: ReleasesService) {}

  @Get('catalog-sync')
  sync(@Headers('authorization') authorization?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret || authorization !== `Bearer ${secret}`) throw new UnauthorizedException();
    return this.service.sync();
  }
}
