import { chromium } from 'playwright';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.SIILVANA_PREVIEW_URL ?? 'http://127.0.0.1:1422';
const filename = (await readdir(new URL('../dist/assets/', import.meta.url))).find(f=>f.startsWith('history-query.worker-') && f.endsWith('.js'));
assert.ok(filename);
const browser = await chromium.launch({ headless:true, channel:'chrome' });
try {
  const page = await browser.newPage();
  await page.route('**/performance-shell', route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated synthetic history benchmark</title>'}));
  await page.goto(`${base}/performance-shell`);
  const result = await page.evaluate(async url => {
    const worker=new Worker(url,{type:'module'});const pending=new Map();let sequence=0,maxSendMs=0;
    worker.onmessage=event=>{pending.get(event.data.id)?.(event.data);pending.delete(event.data.id);};
    const send=message=>new Promise(resolve=>{const id=++sequence;pending.set(id,resolve);const started=performance.now();worker.postMessage({id,toolId:'synthetic',...message});maxSendMs=Math.max(maxSendMs,performance.now()-started);});
    await send({phase:'reset'});
    for(let start=0;start<100000;start+=1000){
      const records=Array.from({length:1000},(_,offset)=>{const i=start+offset;const version=`${Math.floor(i/1000)}.0.${i%1000}`;return {releaseId:String(i).padStart(64,'0'),toolId:'synthetic',version,rawVersion:version,build:'',isPrerelease:i%10===0,normalizedSortKey:String(i).padStart(16,'0')};});
      await send({phase:'append',records,final:start===99000});
    }
    const durations=[];let count=0;
    for(let i=0;i<30;i++){const started=performance.now();const response=await send({q:i%2?'99.0.':'',page:1,includePrerelease:false});durations.push(performance.now()-started);if(i===0)count=response.total;}
    worker.terminate();durations.sort((a,b)=>a-b);
    return {corpus:'100000 synthetic minimal release records',count,queryP95Ms:durations[Math.ceil(durations.length*.95)-1],maxSendMs};
  },`${base}/assets/${filename}`);
  assert.equal(result.count,90000);assert.ok(result.queryP95Ms<=200,JSON.stringify(result));assert.ok(result.maxSendMs<=50,JSON.stringify(result));
  const directory=new URL('../../artifacts/history-v2/',import.meta.url);await mkdir(directory,{recursive:true});await writeFile(new URL('performance.json',directory),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {await browser.close();}
