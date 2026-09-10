import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { InjectDatabase, type Database } from '../../infrastructure/database/database.module.js';

@Controller('health')
export class HealthController {
  constructor(@InjectDatabase() private readonly database: Database | null) {}
  @Get()
  health() { return { status: 'ok', service: 'siilvana-server' }; }
  @Get('ready')
  async ready() {
    try {
      if (!this.database) throw new Error('No database');
      const result = await this.database.$client.query('SELECT manifest_revision::text FROM history_manifests WHERE dataset_id=$1 ORDER BY history_manifests.manifest_revision DESC LIMIT 1',[process.env.HISTORY_DATASET_ID ?? 'siilvana-local']);
      if (!result.rows.length) throw new Error('No published snapshot');
      return { status: 'ready', manifestRevision: result.rows[0].manifest_revision };
    } catch { throw new ServiceUnavailableException('History database or publication is not ready'); }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
