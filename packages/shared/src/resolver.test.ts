import { describe, expect, it } from 'vitest';
import type { Catalog } from './types.js';
import { resolveSelections, satisfies, sortSelections } from './resolver.js';
import { isCatalog } from './catalog-validation.js';

const catalog: Catalog = {
  schemaVersion: 1,
  revision: 'test',
  generatedAt: '2026-09-06T00:00:00Z',
  tools: [
    {
      id: 'runtime', name: 'Runtime', description: '', category: 'runtime', homepage: '', icon: 'box', diskMb: 10,
      versions: [{ id: 'runtime-20', version: '20.1.0', channel: 'lts', recommended: true }], recipes: [],
    },
    {
      id: 'manager', name: 'Manager', description: '', category: 'package-manager', homepage: '', icon: 'box', diskMb: 2,
      versions: [{ id: 'manager-1', version: '1.0.0', channel: 'stable', recommended: true }], recipes: [],
    },
  ],
  dependencies: [{ sourceToolId: 'manager', targetToolId: 'runtime', targetRange: '>=20', kind: 'requires' }],
  compatibility: [],
  templates: [],
};

describe('version matching', () => {
  it('normalizes major and minor versions before applying ranges', () => {
    expect(satisfies('20', '>=18')).toBe(true);
    expect(satisfies('20.1', '>=20 <21')).toBe(true);
    expect(satisfies('stable', 'stable')).toBe(true);
  });
});

describe('dependency resolution', () => {
  it('adds required dependencies and sorts them first', () => {
    const resolved = resolveSelections(catalog, [{ toolId: 'manager', versionId: 'manager-1' }]);
    expect(resolved.selections).toContainEqual({ toolId: 'runtime', versionId: 'runtime-20', reason: 'required' });
    expect(sortSelections(catalog, resolved.selections).map((item) => item.toolId)).toEqual(['runtime', 'manager']);
  });

  it('rejects dependency cycles', () => {
    const cyclic: Catalog = {
      ...catalog,
      dependencies: [
        ...catalog.dependencies,
        { sourceToolId: 'runtime', targetToolId: 'manager', kind: 'requires' },
      ],
    };
    expect(() => sortSelections(cyclic, [
      { toolId: 'manager', versionId: 'manager-1' },
      { toolId: 'runtime', versionId: 'runtime-20' },
    ])).toThrow('Dependency cycle');
  });
});

describe('catalog validation', () => {
  it('rejects a damaged cache payload', () => {
    expect(isCatalog(catalog)).toBe(true);
    expect(isCatalog({ ...catalog, tools: [{ id: 'unsafe' }] })).toBe(false);
  });
});
