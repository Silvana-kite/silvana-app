import { HistoryOperations } from './modules/releases/ops.controller.js';
import 'reflect-metadata';
import './infrastructure/source-tls.js';
import { readFile } from 'node:fs/promises';
import { HistoryService } from './modules/releases/history.service.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { migrate } from './infrastructure/database/migrate.js';
import { formatDatabaseError } from './infrastructure/database/errors.js';
import { ReleasesService } from './modules/releases/releases.service.js';

async function main() {
  if (process.argv.includes('--migrate')) {
    await migrate(process.env.DATABASE_URL, process.argv.includes('--neon') ? 'neon' : 'tcp');
    console.log('Release history migration applied');
    return;
  }
  if (process.env.HISTORY_SIGNING_KEY_FILE) process.env.HISTORY_SIGNING_KEY = await readFile(process.env.HISTORY_SIGNING_KEY_FILE, 'utf8');
  if (new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/unconfigured').pathname.endsWith('_test') && !process.env.RELEASE_TEST_DATABASE_URL) throw new Error('Daily collection must not use a test database');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const tools = process.argv.find(a => a.startsWith('--tools='))?.slice(8).split(',');
    const result = await app.get(ReleasesService).sync(tools, { force: process.argv.includes('--force'), budgetMs: process.argv.includes('--all') ? Number.POSITIVE_INFINITY : 45_000 });
    if (process.env.HISTORY_SIGNING_KEY) await app.get(HistoryService).publish();
    await app.get(HistoryOperations).evaluate();
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'partial' || result.status === 'busy' || result.status === 'pending') process.exitCode = 1;
  } finally { await app.close(); }
}
main().catch(error => { console.error(formatDatabaseError(error)); process.exitCode = 1; });
