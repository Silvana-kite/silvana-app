import { Controller, Get, Param, Query, Headers, Res, BadRequestException, NotFoundException } from '@nestjs/common';
import { catalog, latestDownload } from '@siilvana/catalog';
import type { Response } from 'express';
import { canonicalJson } from '@siilvana/shared';
import { HistoryService } from './history.service.js';
import { hash } from './history-codec.js';

@Controller('v2')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}
  @Get('tools/:id/latest-download')
  latest(@Param('id') id: string, @Query('platform') platform: string, @Query('architecture') architecture: string) {
    if (!['windows','macos','linux'].includes(platform) || !['x64','arm64'].includes(architecture)) throw new BadRequestException('Invalid download target');
    const tool = catalog.tools.find(t => t.id === id && t.historyPolicy === 'latest-only'); if (!tool) throw new NotFoundException();
    return latestDownload(tool, platform as 'windows' | 'macos' | 'linux', architecture as 'x64' | 'arm64');
  }
  private respond(value: unknown, revision: string, previous: string | undefined, response: Response) {
    const etag = `"${revision}-${hash(canonicalJson(value))}"`; response.setHeader('ETag', etag); response.setHeader('Cache-Control', 'public,max-age=300');
    if (previous === etag) { response.status(304); return; } return value;
  }
  @Get('release-history/manifest')
  async manifest(@Headers('if-none-match') previous: string | undefined, @Res({ passthrough: true }) response: Response) {
    const value = await this.history.manifest(); return this.respond(value, value.manifestRevision, previous, response);
  }
  @Get('tools/:id/history-snapshot')
  async snapshot(@Param('id') id: string, @Query('revision') revision: string | undefined, @Headers('if-none-match') previous: string | undefined, @Headers('if-match') match: string | undefined, @Res({ passthrough: true }) response: Response) {
    const value = await this.history.snapshot(id, revision);
    if (match && match !== `"${value.toolRevision}-${hash(canonicalJson(value))}"`) { response.status(412); return; }
    return this.respond(value, value.toolRevision, previous, response);
  }
  @Get('tools/:id/history-diff')
  diff(@Param('id') id: string, @Query('from') from: string, @Query('to') to: string) { return this.history.diff(id, from, to); }
  @Get('release-history/blobs/:hash')
  async blob(@Param('hash') digest: string, @Res() response: Response) {
    const value = await this.history.blob(digest); response.setHeader('Content-Type', 'application/octet-stream'); response.setHeader('Cache-Control', 'public,max-age=31536000,immutable'); response.send(value);
  }
}
