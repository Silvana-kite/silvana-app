import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('Run this task through pnpm');
execFileSync(process.execPath, [fileURLToPath(new URL('./catalog/start-local.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true });
for (const name of ['shared','catalog']) execFileSync(process.execPath, [pnpm,'--filter',`@siilvana/${name}`,'build'], { stdio: 'inherit', windowsHide: true });
const children = [
  spawn(process.execPath, [pnpm,'--filter','@siilvana/server','dev'], { stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, [pnpm,'--filter','@siilvana/desktop',process.argv.includes('--web') ? 'dev:web' : 'dev'], { stdio: 'inherit', windowsHide: true }),
];
let stopped = false;
function stop(code = 0) { if (stopped) return; stopped = true; for (const child of children) child.kill(); process.exitCode = code; }
for (const child of children) child.on('exit', code => stop(code ?? 1));
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
