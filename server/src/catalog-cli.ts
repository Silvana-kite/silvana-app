import 'reflect-metadata';
import './infrastructure/source-tls.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { migrate } from './infrastructure/database/migrate.js';
import { ReleasesService } from './modules/releases/releases.service.js';

async function main() {
  if (process.argv.includes('--migrate')) { await migrate(); console.log('Release history migration applied'); return; }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const tools = process.argv.find(a => a.startsWith('--tools='))?.slice(8).split(',');
    const result = await app.get(ReleasesService).sync(tools, { force: process.argv.includes('--force'), budgetMs: process.argv.includes('--all') ? Number.POSITIVE_INFINITY : 45_000 });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'partial' || result.status === 'busy') process.exitCode = 1;
  } finally { await app.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
