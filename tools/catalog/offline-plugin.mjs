import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
export function offlineHistoryPlugin() {
  let output;
  return { name: 'offline-history', apply: 'build', configResolved(config) { output = resolve(config.root, config.build.outDir); }, async closeBundle() {
    const walk = async (dir, prefix = '') => { const paths = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const name = `${prefix}${entry.name}`; if (entry.isDirectory()) paths.push(...await walk(resolve(dir, entry.name), `${name}/`)); else paths.push(name); } return paths; };
    const paths = (await walk(output)).filter(p => p === 'index.html' || p.startsWith('history/') || /^assets\/.*\.(js|css|woff2)$/.test(p));
    const identity = createHash('sha256'); for (const path of paths.sort()) identity.update(path).update(await readFile(resolve(output,path)));
    const version = `siilvana-${identity.digest('hex').slice(0,20)}`;
    const code = `const CACHE=${JSON.stringify(version)},FILES=${JSON.stringify(paths.map(p => '/'+p))};
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);try{await cache.addAll(FILES)}catch(error){await caches.delete(CACHE);throw error}})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE')self.skipWaiting()});
self.addEventListener('activate',event=>event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});if(clients.length<=1)for(const key of await caches.keys())if(key.startsWith('siilvana-')&&key!==CACHE)await caches.delete(key);await self.clients.claim()})()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==location.origin)return;if(FILES.includes(url.pathname)||event.request.mode==='navigate'){event.respondWith((async()=>{const cache=await caches.open(CACHE);const key=event.request.mode==='navigate'?'/index.html':url.pathname;return await cache.match(key)||fetch(event.request)})())}});`;
    await writeFile(resolve(output, 'sw.js'), code);
  } };
}
