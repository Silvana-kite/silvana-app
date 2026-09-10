import { Controller, Get, Headers, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { ReleasesService } from './releases.service.js';

@ApiTags('release-history')
@Controller('tools')
export class ReleasesController {
  constructor(private readonly service: ReleasesService) {}
  @Get(':id/versions')
  async list(@Param('id') id: string, @Query() query: { q?: string; page?: string; pageSize?: string; platform?: string; architecture?: string }, @Headers('if-none-match') previous: string | undefined, @Res({ passthrough: true }) response: Response) {
    const page = await this.service.list(id, query);
    const etag = `"releases-${createHash('sha256').update(JSON.stringify(page)).digest('hex').slice(0, 20)}"`;
    response.setHeader('ETag', etag);
    response.setHeader('Cache-Control', page.status === 'ready' ? 'public, max-age=300' : 'no-cache');
    if (previous === etag) { response.status(304); return undefined; }
    return page;
  }
}
