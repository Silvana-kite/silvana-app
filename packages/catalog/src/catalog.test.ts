import { describe, expect, it } from 'vitest';
import { createInstallPlan, resolveSelections } from '@siilvana/shared';
import { catalog } from './index.js';

describe('catalog integration', () => {
  it('adds Volta, Node and bundled npm before pnpm', () => {
    const resolved = resolveSelections(catalog, [{ toolId: 'pnpm', versionId: 'pnpm-10.34.5' }]);
    expect(resolved.selections.map((selection) => selection.toolId)).toEqual(
      expect.arrayContaining(['pnpm', 'node', 'npm', 'volta']),
    );

    const plan = createInstallPlan(catalog, {
      platform: 'windows', architecture: 'x64', preferredManagers: ['winget', 'volta', 'npm'],
      selections: [{ toolId: 'pnpm', versionId: 'pnpm-10.34.5' }],
    });
    expect(plan.steps.map((step) => step.toolId)).toEqual(['volta', 'node', 'pnpm']);
    expect(plan.script.content).toContain("npm 'install' '--global' 'pnpm@10.34.5'");
  });

  it('reports an unavailable platform recipe', () => {
    const plan = createInstallPlan(catalog, {
      platform: 'linux', architecture: 'x64', preferredManagers: ['apt'],
      selections: [{ toolId: 'python', versionId: 'python-3.13' }],
    });
    expect(plan.diagnostics.some((item) => item.code === 'RECIPE_UNAVAILABLE')).toBe(true);
  });

  it('provides the official repository package for Linux VS Code', () => {
    const plan = createInstallPlan(catalog, { platform: 'linux', architecture: 'arm64', preferredManagers: ['apt'], selections: [{ toolId: 'vscode', versionId: 'vscode-stable' }] });
    expect(plan.diagnostics).toEqual([]);
    expect(plan.steps[0]?.action).toEqual({ kind: 'process', process: { executable: 'sudo', args: ['apt-get', 'install', '-y', 'code'] } });
  });

  it('uses only the reviewed Volta installer on Linux', () => {
    const plan = createInstallPlan(catalog, {
      platform: 'linux', architecture: 'x64', preferredManagers: ['official', 'apt', 'volta', 'npm'],
      selections: [{ toolId: 'pnpm', versionId: 'pnpm-10.34.5' }],
    });
    expect(plan.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(plan.steps.map((step) => step.toolId)).toEqual(['volta', 'node', 'pnpm']);
    expect(plan.script.content).toContain("curl --proto '=https' --tlsv1.2 -fsS 'https://get.volta.sh' | bash");
  });
});
