import type { HistoryQuality, Tool } from '@siilvana/shared';
import { sources } from './sources.js';

export function sourceQuality(tool: Tool, state?: { status: string; updated_at?: Date; error?: string; coverage_override?: string }): HistoryQuality {
  const source = sources.find(s => s.toolId === tool.id);
  const lastSuccessAt = state?.updated_at?.toISOString() ?? null;
  const scope = source?.scope ?? '官方公开发布记录';
  if (tool.historyPolicy === 'latest-only') return { coverage: 'latest-only', scope: '官方最新版下载入口', sourceStatus: 'disabled', lastSuccessAt: null, missingReason: '此软件不提供历史查询' };
  if (!source) return { coverage: 'undisclosed', scope, sourceStatus: 'disabled', lastSuccessAt: null, missingReason: '尚无经过验证的公开历史来源' };
  return { coverage: state?.coverage_override === 'partial' ? 'partial' : lastSuccessAt ? source.coverage ?? 'partial' : 'partial', scope,
    sourceStatus: (['ready', 'syncing', 'failed', 'pending'].includes(state?.status ?? '') ? state!.status : 'pending') as HistoryQuality['sourceStatus'],
    lastSuccessAt, missingReason: state?.coverage_override === 'partial' ? '迁移记录的来源覆盖尚未重新核验' : state?.status === 'failed' ? state.error ?? '采集失败，保留上次数据' : !lastSuccessAt ? '首次采集尚未完成' : source.coverage === 'full' ? null : '仅覆盖厂商当前公开的归档，无法证明全部历史均已公开' };
}
