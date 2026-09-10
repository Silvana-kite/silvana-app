import { compareHistory, type HistoryRelease } from '@siilvana/shared';
const tools = new Map<string, { records: HistoryRelease[]; text: string[] }>();
self.onmessage = (event: MessageEvent<{ id: number; toolId: string; phase?: 'reset' | 'append'; final?: boolean; records?: HistoryRelease[]; q?: string; page?: number; includePrerelease?: boolean }>) => {
  const request = event.data;
  if (request.phase === 'reset') tools.set(request.toolId, { records: [], text: [] });
  const tool = tools.get(request.toolId) ?? { records: [], text: [] };
  if (request.phase === 'append') {
    tool.records.push(...(request.records ?? []));
    if (request.final) { tool.records.sort(compareHistory); tool.text = tool.records.map(r => `${r.rawVersion} ${r.version} ${r.build}`.toLowerCase()); }
  }
  if (request.phase) { self.postMessage({ id: request.id, total: 0, items: [] }); return; }
  const needle = request.q?.trim().toLowerCase() ?? ''; const start = ((request.page ?? 1) - 1) * 50;
  const items: HistoryRelease[] = []; let total = 0;
  for (let i = 0; i < tool.records.length; i++) {
    const row = tool.records[i]!;
    if ((!request.includePrerelease && row.isPrerelease) || !tool.text[i]?.includes(needle)) continue;
    if (total >= start && items.length < 50) items.push(row); total++;
  }
  self.postMessage({ id: request.id, total, items });
};
