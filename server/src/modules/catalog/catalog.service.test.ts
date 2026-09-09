import { describe, expect, it } from 'vitest';
import { CatalogService } from './catalog.service.js';

describe('CatalogService', () => {
  const service = new CatalogService();

  it('publishes a stable strong ETag', () => {
    expect(service.etag).toMatch(/^"catalog-[a-f0-9]{16}"$/);
    expect(new CatalogService().etag).toBe(service.etag);
  });

  it('filters tools by platform and category', () => {
    expect(service.listTools(undefined, 'editor', 'linux').map(tool => tool.id)).toEqual(['vscode']);
    expect(service.listTools('volta', undefined, 'linux').map((tool) => tool.id)).toEqual(['volta']);
  });

  it('returns a safe Linux JavaScript install plan', () => {
    const plan = service.createPlan({
      platform: 'linux', architecture: 'x64', preferredManagers: ['official', 'apt', 'volta', 'npm'],
      selections: [{ toolId: 'pnpm', versionId: 'pnpm-10.34.5' }],
    });
    expect(plan.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(plan.script.content).not.toContain('undefined');
  });
});
