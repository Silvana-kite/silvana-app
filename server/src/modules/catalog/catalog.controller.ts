import { Body, Controller, Get, Headers, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CatalogService } from './catalog.service.js';
import { InstallPlanDto, RecommendationDto } from './dto/install-plan.dto.js';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly service: CatalogService) {}

  @Get('catalog')
  @ApiOkResponse({ description: '完整离线目录' })
  catalog(@Headers('if-none-match') ifNoneMatch: string | undefined, @Res({ passthrough: true }) response: Response) {
    response.setHeader('ETag', this.service.etag);
    response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
    if (ifNoneMatch === this.service.etag) {
      response.status(304);
      return undefined;
    }
    return this.service.catalog;
  }

  @Get('categories')
  categories() {
    return [...new Set(this.service.catalog.tools.map((tool) => tool.category))];
  }

  @Get('tools')
  tools(@Query('q') query?: string, @Query('category') category?: string, @Query('platform') platform?: string) {
    return this.service.listTools(query, category, platform);
  }

  @Get('tools/:id')
  tool(@Param('id') id: string) {
    const tool = this.service.catalog.tools.find((candidate) => candidate.id === id);
    if (!tool) throw new NotFoundException(`Unknown tool: ${id}`);
    return tool;
  }

  @Get('templates')
  templates() { return this.service.catalog.templates; }

  @Get('templates/:id')
  template(@Param('id') id: string) {
    const template = this.service.catalog.templates.find((candidate) => candidate.id === id);
    if (!template) throw new NotFoundException(`Unknown template: ${id}`);
    return template;
  }

  @Post('recommendations')
  recommendations(@Body() body: RecommendationDto) { return this.service.recommend(body.scenario); }

  @Post('install-plans')
  installPlan(@Body() body: InstallPlanDto) { return this.service.createPlan(body); }
}
