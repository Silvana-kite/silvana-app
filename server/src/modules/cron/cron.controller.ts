import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service.js';

@Controller('internal/cron')
export class CatalogCronController {
  constructor(private readonly service: CatalogService) {}

  @Get('catalog-sync')
  sync(@Headers('authorization') authorization?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret || authorization !== `Bearer ${secret}`) throw new UnauthorizedException();
    return { ok: true, revision: this.service.catalog.revision, message: 'MVP uses the reviewed embedded catalog.' };
  }
}

