import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const projects = JSON.parse(execFileSync(pnpm, ['list','-r','--depth','Infinity','--json'], { encoding: 'utf8', maxBuffer: 64*1024*1024, shell: process.platform === 'win32', windowsHide: true }));
const components = new Map();
function visit(dependencies) { for (const [name,item] of Object.entries(dependencies ?? {})) {
  if (!item.version?.startsWith('link:')) { const purl = `pkg:npm/${name.replace('@','%40')}@${encodeURIComponent(item.version)}`;
    components.set(purl, { type: 'library', 'bom-ref': purl, name, version: item.version, purl }); }
  visit(item.dependencies); visit(item.optionalDependencies);
} }
for (const project of projects) { visit(project.dependencies); visit(project.devDependencies); }
const cargo = await readFile('desktop/src-tauri/Cargo.lock','utf8');
for (const block of cargo.split('[[package]]').slice(1)) {
  const name = /^name = "([^"]+)"/m.exec(block)?.[1]; const version = /^version = "([^"]+)"/m.exec(block)?.[1]; const checksum = /^checksum = "([a-f0-9]+)"/m.exec(block)?.[1];
  if (name && version) { const purl = `pkg:cargo/${name}@${version}`; components.set(purl, { type: 'library', 'bom-ref': purl, name, version, purl, ...(checksum ? { hashes: [{ alg: 'SHA-256', content: checksum }] } : {}) }); }
}
await mkdir('artifacts/supply-chain', { recursive: true });
await writeFile('artifacts/supply-chain/sbom.cdx.json', JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${randomUUID()}`, version: 1,
  metadata: { timestamp: new Date().toISOString(), component: { type: 'application', name: 'siilvana-app', version: '0.1.0' } }, components: [...components.values()] }, null, 2));
console.log(`SBOM written with ${components.size} resolved npm and Cargo components`);
