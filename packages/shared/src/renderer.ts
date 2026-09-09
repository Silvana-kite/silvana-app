import type { Catalog, InstallAction, InstallPlan, InstallPlanRequest, InstallRecipe, InstallStep, ProcessSpec } from './types.js';
import { resolveSelections, sortSelections, validatePlanRequest } from './resolver.js';

function processFor(recipe: InstallRecipe): ProcessSpec {
  switch (recipe.manager) {
    case 'winget':
      return { executable: 'winget', args: ['install', '--id', recipe.packageId, '--exact', '--accept-package-agreements', '--accept-source-agreements', ...(recipe.arguments ?? [])] };
    case 'brew':
      return { executable: 'brew', args: ['install', recipe.packageId, ...(recipe.arguments ?? [])] };
    case 'apt':
      return { executable: 'sudo', args: ['apt-get', 'install', '-y', recipe.packageId, ...(recipe.arguments ?? [])] };
    case 'volta':
      return { executable: 'volta', args: ['install', recipe.packageId, ...(recipe.arguments ?? [])] };
    case 'npm':
      return { executable: 'npm', args: ['install', '--global', recipe.packageId, ...(recipe.arguments ?? [])] };
    case 'scoop':
      return { executable: 'scoop', args: ['install', recipe.packageId, ...(recipe.arguments ?? [])] };
    case 'choco':
      return { executable: 'choco', args: ['install', recipe.packageId, '-y', ...(recipe.arguments ?? [])] };
    case 'official':
      throw new Error('Official installers must use an approved script action');
  }
}

function actionFor(recipe: InstallRecipe): InstallAction {
  if (recipe.strategy === 'official-installer') {
    if (recipe.manager === 'official' && recipe.packageId === 'volta-unix') {
      return { kind: 'approved-script', scriptId: 'volta-unix' };
    }
    throw new Error(`Unknown official installer: ${recipe.manager}/${recipe.packageId}`);
  }
  return { kind: 'process', process: processFor(recipe) };
}

function quoteBash(value: string) {
  if (/[\0\n\r]/.test(value)) throw new Error('Unsafe Bash argument');
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function quotePowerShell(value: string) {
  if (/[\0\r\n]/.test(value)) throw new Error('Unsafe PowerShell argument');
  return `'${value.replaceAll("'", "''")}'`;
}

function command(spec: ProcessSpec, shell: 'powershell' | 'bash') {
  if (!/^[A-Za-z0-9._+-]+$/.test(spec.executable)) throw new Error('Unsafe executable');
  const quote = shell === 'powershell' ? quotePowerShell : quoteBash;
  return [spec.executable, ...spec.args.map(quote)].join(' ');
}

function installCommand(action: InstallAction, shell: 'powershell' | 'bash') {
  if (action.kind === 'process') return command(action.process, shell);
  if (action.scriptId === 'volta-unix' && shell === 'bash') {
    return "curl --proto '=https' --tlsv1.2 -fsS 'https://get.volta.sh' | bash";
  }
  throw new Error(`Approved installer ${action.scriptId} is unavailable for ${shell}`);
}

export function renderScript(steps: InstallStep[], shell: 'powershell' | 'bash', revision: string) {
  const header = shell === 'powershell'
    ? [`# Siilvana catalog ${revision}`, "$ErrorActionPreference = 'Stop'", 'Set-StrictMode -Version Latest', '']
    : [`#!/usr/bin/env bash`, `# Siilvana catalog ${revision}`, 'set -Eeuo pipefail', ''];
  const lines = steps.flatMap((step) => [
    `# ${step.toolName} ${step.version}`,
    installCommand(step.action, shell),
    command(step.verify, shell),
    '',
  ]);
  return [...header, ...lines].join('\n');
}

export function createInstallPlan(catalog: Catalog, request: InstallPlanRequest): InstallPlan {
  const validation = validatePlanRequest(catalog, request);
  const resolved = resolveSelections(catalog, request.selections);
  let ordered = resolved.selections;
  const diagnostics = [...validation, ...resolved.diagnostics];
  try {
    ordered = sortSelections(catalog, resolved.selections);
  } catch (error) {
    diagnostics.push({ code: 'DEPENDENCY_CYCLE', severity: 'error', toolIds: [], message: String(error) });
  }

  const steps: InstallStep[] = [];
  for (const selection of ordered) {
    const tool = catalog.tools.find((candidate) => candidate.id === selection.toolId);
    const version = tool?.versions.find((candidate) => candidate.id === selection.versionId);
    if (!tool || !version) continue;
    const recipes = tool.recipes.filter((recipe) =>
      recipe.versionId === version.id
      && recipe.platform === request.platform
      && (recipe.architecture === 'any' || recipe.architecture === request.architecture)
      && recipe.approved,
    );
    const recipe = request.preferredManagers
      .map((manager) => recipes.find((candidate) => candidate.manager === manager))
      .find(Boolean) ?? recipes[0];
    if (!recipe) {
      if (tool.id !== 'npm') diagnostics.push({
        code: 'RECIPE_UNAVAILABLE', severity: 'error', toolIds: [tool.id],
        message: `${tool.name} ${version.version} 暂无适用于当前平台的安装方式。`,
      });
      continue;
    }
    steps.push({
      id: recipe.id,
      toolId: tool.id,
      toolName: tool.name,
      versionId: version.id,
      version: version.version,
      manager: recipe.manager,
      strategy: recipe.strategy,
      reason: selection.reason === 'required' ? 'required' : 'explicit',
      action: actionFor(recipe),
      verify: recipe.verify,
    });
  }

  const shell = request.platform === 'windows' ? 'powershell' : 'bash';
  return {
    catalogRevision: catalog.revision,
    selections: ordered,
    steps,
    diagnostics,
    estimatedDiskMb: ordered.reduce((sum, selection) => sum + (catalog.tools.find((tool) => tool.id === selection.toolId)?.diskMb ?? 0), 0),
    script: { shell, content: renderScript(steps, shell, catalog.revision) },
  };
}
