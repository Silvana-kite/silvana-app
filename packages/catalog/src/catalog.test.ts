import { describe, expect, it } from 'vitest';
import { createInstallPlan, resolveSelections } from '@siilvana/shared';
import { catalog } from './index.js';

describe('catalog integration', () => {
  it('adds standalone Node and npm before pnpm without requiring Volta', () => {
    const resolved = resolveSelections(catalog, [{ toolId: 'pnpm', versionId: 'pnpm-10.34.5' }]);
    expect(resolved.selections.map((selection) => selection.toolId)).toEqual(
      ['pnpm', 'node', 'npm'],
    );

    const plan = createInstallPlan(catalog, {
      platform: 'windows', architecture: 'x64', preferredManagers: ['winget', 'volta', 'npm'],
      selections: [{ toolId: 'pnpm', versionId: 'pnpm-10.34.5' }],
    });
    expect(plan.steps.map((step) => step.toolId)).toEqual(['node', 'pnpm']);
    expect(plan.steps[0]?.manager).toBe('winget');
    expect(plan.script.content).toContain('OpenJS.NodeJS.LTS');
    expect(plan.script.content.indexOf("$env:Path =")).toBeLessThan(plan.script.content.indexOf("node '--version'"));
    expect(plan.script.content).toContain("GetEnvironmentVariable('Path', 'Machine')");
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
      selections: [{ toolId: 'pnpm', versionId: 'pnpm-10.34.5' }, { toolId: 'node', versionId: 'node-24.20.0' }],
    });
    expect(plan.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(plan.steps.map((step) => step.toolId)).toEqual(['volta', 'node', 'pnpm']);
    expect(plan.script.content).toContain("curl --proto '=https' --tlsv1.2 -fsS 'https://get.volta.sh' | bash");
  });

  it.each(['windows', 'macos', 'linux'] as const)('uses standalone Node by default on %s', platform => {
    const plan = createInstallPlan(catalog, { platform, architecture: 'arm64', preferredManagers: ['volta', 'winget', 'brew', 'apt', 'npm'], selections: [{ toolId: 'pnpm', versionId: 'pnpm-10.34.5' }] });
    expect(plan.diagnostics).toEqual([]);
    expect(plan.selections.map(item => item.toolId)).not.toContain('volta');
    expect(plan.steps.map(item => item.toolId)).toEqual(['node', 'pnpm']);
    expect(plan.steps[0]?.manager).toBe(({ windows: 'winget', macos: 'brew', linux: 'apt' })[platform]);
    if (platform === 'linux') expect(plan.script.content).toContain("'nodejs' 'npm'");
    if (platform === 'macos') expect(plan.script.content).toContain('export PATH="$(brew --prefix node@24)/bin:$PATH"');
  });
});
