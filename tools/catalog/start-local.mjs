import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
let config;
try { config = JSON.parse(await readFile(resolve(root, '.runtime/history/local-database.json'), 'utf8')); } catch { process.exit(0); }
const data = resolve(root, config.dataDirectory); const rel = relative(resolve(root, '.runtime'), data);
if (rel.startsWith('..') || isAbsolute(rel) || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Invalid local database configuration');
const run = args => execFileSync(config.pgCtl, args, { windowsHide: true, timeout: 30000, stdio: 'pipe' });
try { execFileSync(resolve(dirname(config.pgCtl), process.platform === 'win32' ? 'pg_isready.exe' : 'pg_isready'), ['-h','127.0.0.1','-p',String(config.port),'-q'], { windowsHide: true, timeout: 5000 }); console.log('Local history database is running'); }
catch { run(['start','-D',data,'-l',resolve(root,'.runtime/history/postgres.log'),'-o',`-h 127.0.0.1 -p ${config.port}`,'-w','-t','20']); console.log('Local history database started'); }
