import { HistoryOperations, HistoryOpsController } from './ops.controller.js';
import { HistoryController } from './history.controller.js';
import { HistoryService } from './history.service.js';
import { Module } from '@nestjs/common';
import { ReleaseRepository } from './release.repository.js';
import { SourceHttp } from './source-http.js';
import { ReleasesService } from './releases.service.js';
import { ReleasesController } from './releases.controller.js';

@Module({ controllers: [ReleasesController, HistoryController, HistoryOpsController], providers: [ReleaseRepository, SourceHttp, ReleasesService, HistoryService, HistoryOperations], exports: [ReleasesService, HistoryService, HistoryOperations] })
export class ReleasesModule {}
