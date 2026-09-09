import { describe, expect, it } from 'vitest';
import { catalog } from '@siilvana/catalog';
import { createInstallPlan } from '@siilvana/shared';
import { driveId, effectiveTargets, locationErrors, locationLabel, targetBudgets } from './installation-locations';
import { requiredBytes, type DiskInfo } from './device';

const plan = (tools: string[]) => createInstallPlan(catalog, { platform: 'windows', architecture: 'x64', preferredManagers: ['winget', 'volta', 'npm'],
  selections: tools.map(toolId => ({ toolId, versionId: catalog.tools.find(tool => tool.id === toolId)!.versions.find(version => version.recommended)!.id })) });
const disk = (id: string, temporaryTarget = false): DiskInfo => ({ id, label: id, totalBytes: 100 * 1024 ** 3, availableBytes: 80 * 1024 ** 3, temporaryTarget });

describe('per-tool installation targets', () => {
  it('normalizes drive roots without accepting folders, UNC paths or command text', () => {
    expect(driveId('d:/')).toBe('D:\\');
    for (const value of ['D:', 'D:\\Apps', '\\\\host\\share', 'D:\\;whoami', 'D:\\..\\C:\\']) expect(driveId(value)).toBeNull();
  });
  it('binds npm to Node and includes automatically resolved dependencies', () => {
    const value = plan(['pnpm']);
    const targets = effectiveTargets(catalog, value, { node: 'D:\\', npm: 'E:\\', pnpm: 'E:\\', volta: 'C:\\', git: 'Z:\\' });
    expect(targets).toEqual({ node: 'D:\\', npm: 'D:\\', pnpm: 'E:\\', volta: 'C:\\' });
  });
  it('sums programs on each disk and reserves cache space only once on its volume', () => {
    const value = plan(['git', 'vscode']);
    expect(targetBudgets(catalog, value, { git: 'D:\\', vscode: 'E:\\' }, [disk('C:\\', true), disk('D:\\'), disk('E:\\'), disk('F:\\')]))
      .toEqual({ 'D:\\': requiredBytes(350), 'E:\\': requiredBytes(650), 'C:\\': requiredBytes(0) + 1000 * 1024 ** 2 });
    expect(targetBudgets(catalog, value, { git: 'C:\\', vscode: 'C:\\' }, [disk('C:\\', true)]))
      .toEqual({ 'C:\\': requiredBytes(1000) + 1000 * 1024 ** 2 });
  });
  it('reports missing or disconnected targets and never substitutes another drive', () => {
    const value = plan(['git', 'vscode']);
    const targets = { git: 'D:\\' };
    expect(locationErrors(catalog, value, targets, [disk('C:\\')])).toHaveLength(2);
    expect(targets).toEqual({ git: 'D:\\' });
  });
  it('shows an explicit destination only for a reviewed directory recipe', () => {
    expect(locationLabel(catalog, plan(['git']), 'git', 'D:\\')).toBe('D:\\Siilvana\\Apps\\git');
    expect(locationLabel(catalog, plan(['docker']), 'docker', 'D:\\')).toContain('默认目录');
  });
});
