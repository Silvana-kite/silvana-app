import { Module } from '@nestjs/common';
import { ReleaseRepository } from './release.repository.js';
import { SourceHttp } from './source-http.js';
import { ReleasesService } from './releases.service.js';
import { ReleasesController } from './releases.controller.js';

@Module({ controllers: [ReleasesController], providers: [ReleaseRepository, SourceHttp, ReleasesService], exports: [ReleasesService] })
export class ReleasesModule {}
