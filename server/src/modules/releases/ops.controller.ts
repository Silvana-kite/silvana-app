import { Controller, Get, Headers, Res, UnauthorizedException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { InjectDatabase, type Database } from '../../infrastructure/database/database.module.js';
import { catalog } from '@siilvana/catalog';
import { sourceQuality } from './source-quality.js';
import { redactError } from './history-codec.js';

@Injectable()
export class HistoryOperations {
  constructor(@InjectDatabase() private readonly database: Database | null) {}
  async status() {
    if (!this.database) return { configured: false, tools: [], alerts: [] };
    const pool = this.database.$client;
    const states = (await pool.query(`SELECT s.*, (SELECT count(*)::int FROM history_releases r WHERE r.tool_id=s.tool_id) AS count,
      (SELECT max(tool_revision)::text FROM history_snapshots h WHERE h.tool_id=s.tool_id AND dataset_id=$1) AS revision FROM release_sources s`, [process.env.HISTORY_DATASET_ID ?? 'siilvana-local'])).rows;
    const runs = (await pool.query(`SELECT source, count(*)::int AS attempts, count(*) FILTER (WHERE status='success')::int AS successes, percentile_cont(.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at-started_at))) AS duration_p95 FROM sync_runs WHERE started_at>now()-interval '24 hours' GROUP BY source`)).rows;
    const tools = catalog.tools.map(tool => { const state = states.find(s => s.tool_id === tool.id); return { toolId: tool.id, name: tool.name, quality: sourceQuality(tool, state), count: state?.count ?? null, revision: state?.revision ?? null,
      firstAttemptAt: state?.first_attempt_at?.toISOString() ?? null, lastAttemptAt: state?.last_attempt_at?.toISOString() ?? null, attempts: runs.find(r => r.source === tool.id)?.attempts ?? 0, successes: runs.find(r => r.source === tool.id)?.successes ?? 0, durationP95: runs.find(r => r.source === tool.id)?.duration_p95 ?? 0, failures: state?.failures ?? 0, queuedPages: state?.checkpoint?.queue?.length ?? 0 }; });
    const alerts = (await pool.query('SELECT id,tool_id,rule,opened_at,resolved_at,detail,attempts FROM history_alerts ORDER BY opened_at DESC LIMIT 100')).rows;
    return { configured: true, tools, alerts };
  }
  async evaluate() {
    if (!this.database) return;
    const status = await this.status(); const pool = this.database.$client;
    for (const tool of status.tools) {
      if (tool.quality.sourceStatus === 'disabled') continue;
      const checks = [
        ['consecutive-failures', tool.failures >= 3, '连续采集失败至少三次'],
        ['stale', !!(tool.quality.lastSuccessAt ?? tool.firstAttemptAt) && Date.now() - Date.parse((tool.quality.lastSuccessAt ?? tool.firstAttemptAt)!) > 48 * 3600000, '超过 48 小时未成功采集'],
        ['empty', tool.count === 0 && !!tool.quality.lastSuccessAt, '历史记录异常归零'],
      ] as const;
      for (const [rule, active, detail] of checks) {
        if (active) await pool.query('INSERT INTO history_alerts(tool_id,rule,detail) VALUES($1,$2,$3) ON CONFLICT(tool_id,rule) WHERE resolved_at IS NULL DO NOTHING', [tool.toolId, rule, detail]);
        else await pool.query('UPDATE history_alerts SET resolved_at=now(),delivered_at=NULL,attempts=0 WHERE tool_id=$1 AND rule=$2 AND resolved_at IS NULL', [tool.toolId, rule]);
      }
    }
    const target = process.env.OPS_ALERT_WEBHOOK;
    if (!target) return;
    const url = new URL(target); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Alert webhook requires HTTPS');
    const events = (await pool.query('SELECT * FROM history_alerts WHERE delivered_at IS NULL AND attempts<3 ORDER BY opened_at LIMIT 10')).rows;
    for (const event of events) {
      try {
        const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', ...(process.env.OPS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.OPS_WEBHOOK_TOKEN}` } : {}) }, body: JSON.stringify({ id: event.id, toolId: event.tool_id, rule: event.rule, resolved: !!event.resolved_at, detail: event.detail }), signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
        await pool.query('UPDATE history_alerts SET delivered_at=now(),attempts=attempts+1 WHERE id=$1', [event.id]);
      } catch { await pool.query('UPDATE history_alerts SET attempts=attempts+1 WHERE id=$1', [event.id]); }
    }
  }
}
@Controller('ops/history')
export class HistoryOpsController {
  constructor(private readonly operations: HistoryOperations, @InjectDatabase() private readonly database: Database | null) {}
  private authorize(authorization?: string) {
    const expected = Buffer.from(`Bearer ${process.env.OPS_READ_TOKEN ?? ''}`); const actual = Buffer.from(authorization ?? '');
    if (!process.env.OPS_READ_TOKEN || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new UnauthorizedException();
  }
  @Get('status')
  status(@Headers('authorization') authorization?: string) { this.authorize(authorization); return this.operations.status(); }
  @Get('reports')
  async reports(@Headers('authorization') authorization?: string) { this.authorize(authorization); return this.database ? (await this.database.$client.query('SELECT * FROM history_reports ORDER BY created_at DESC LIMIT 100')).rows : []; }
  @Get('metrics')
  async metrics(@Headers('authorization') authorization: string | undefined, @Res() response: Response) {
    this.authorize(authorization); const status = await this.operations.status();
    response.type('text/plain').send(status.tools.flatMap(t => [`history_records{tool="${t.toolId}"} ${t.count ?? 0}`, `history_failures{tool="${t.toolId}"} ${t.failures}`, `history_attempts_24h{tool="${t.toolId}"} ${t.attempts}`, `history_successes_24h{tool="${t.toolId}"} ${t.successes}`, `history_duration_p95_seconds{tool="${t.toolId}"} ${t.durationP95}`, `history_last_success_seconds{tool="${t.toolId}"} ${t.quality.lastSuccessAt ? Date.parse(t.quality.lastSuccessAt)/1000 : 0}`]).join('\n') + '\n');
  }
  @Get()
  page(@Res() response: Response) {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
    response.type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>历史采集状态</title><style>body{font:16px system-ui;margin:32px;color:#243047}table{border-collapse:collapse;width:100%}th,td{padding:12px;text-align:left;border-bottom:1px solid #ddd}input,button{padding:10px;margin:8px}pre{white-space:pre-wrap}</style><h1>历史采集状态</h1><p>只读令牌仅用于本次会话。</p><label>令牌<input id="token" type="password" autocomplete="off"></label><button id="load">查看状态</button><p id="message" role="status"></p><table><thead><tr><th>工具</th><th>覆盖</th><th>版本数</th><th>修订</th><th>状态</th><th>上次成功</th></tr></thead><tbody id="rows"></tbody></table><h2>告警</h2><pre id="alerts"></pre><script>document.getElementById('load').onclick=async()=>{try{const r=await fetch('./history/status',{headers:{Authorization:'Bearer '+document.getElementById('token').value}});if(!r.ok)throw Error('读取失败：'+r.status);const data=await r.json();const body=document.getElementById('rows');body.replaceChildren();for(const t of data.tools){const row=document.createElement('tr');for(const v of [t.name,t.quality.coverage,t.count??'未知',t.revision??'未发布',t.quality.sourceStatus,t.quality.lastSuccessAt??'尚无成功记录']){const td=document.createElement('td');td.textContent=v;row.append(td)}body.append(row)}document.getElementById('alerts').textContent=JSON.stringify(data.alerts,null,2);document.getElementById('message').textContent='已更新'}catch(e){document.getElementById('message').textContent=e.message}};</script></html>`);
  }
}
