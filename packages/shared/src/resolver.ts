import semver from 'semver';
import type {
  Catalog,
  Diagnostic,
  InstallPlanRequest,
  Selection,
  Tool,
  ToolVersion,
} from './types.js';

function normalizedVersion(version: string): string | null {
  const clean = semver.clean(version);
  if (clean) return clean;
  if (/^\d+$/.test(version)) return `${version}.0.0`;
  if (/^\d+\.\d+$/.test(version)) return `${version}.0`;
  return null;
}

export function satisfies(version: string, range: string): boolean {
  if (range === '*') return true;
  const normalized = normalizedVersion(version);
  return normalized ? semver.satisfies(normalized, range) : version === range;
}

function recommendedVersion(tool: Tool, range = '*'): ToolVersion | undefined {
  return tool.versions.find((version) => version.recommended && satisfies(version.version, range))
    ?? tool.versions.find((version) => version.channel !== 'eol' && satisfies(version.version, range));
}

export function resolveSelections(catalog: Catalog, requested: Selection[]) {
  const selected = new Map<string, Selection>();
  const diagnostics: Diagnostic[] = [];

  for (const selection of requested) {
    selected.set(selection.toolId, { ...selection, reason: 'explicit' });
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const selection of [...selected.values()]) {
      const version = catalog.tools
        .find((tool) => tool.id === selection.toolId)
        ?.versions.find((candidate) => candidate.id === selection.versionId);

      if (version?.managedByToolId && !selected.has(version.managedByToolId)) {
        const manager = catalog.tools.find((tool) => tool.id === version.managedByToolId);
        const managerVersion = manager && recommendedVersion(manager);
        if (manager && managerVersion) {
          selected.set(manager.id, { toolId: manager.id, versionId: managerVersion.id, reason: 'required' });
          changed = true;
        }
      }

      for (const bundled of version?.bundledTools ?? []) {
        if (selected.has(bundled.toolId)) continue;
        const bundledTool = catalog.tools.find((tool) => tool.id === bundled.toolId);
        const bundledVersion = bundledTool?.versions.find((candidate) => candidate.version === bundled.version)
          ?? (bundledTool && recommendedVersion(bundledTool));
        if (bundledTool && bundledVersion) {
          selected.set(bundledTool.id, {
            toolId: bundledTool.id,
            versionId: bundledVersion.id,
            reason: 'bundled',
          });
          changed = true;
        }
      }

      for (const rule of catalog.dependencies.filter(
        (candidate) => candidate.sourceToolId === selection.toolId && candidate.kind === 'requires',
      )) {
        if (selected.has(rule.targetToolId)) continue;
        const target = catalog.tools.find((tool) => tool.id === rule.targetToolId);
        const targetVersion = target && recommendedVersion(target, rule.targetRange);
        if (!target || !targetVersion) {
          diagnostics.push({
            code: 'DEPENDENCY_UNAVAILABLE',
            severity: 'error',
            toolIds: [selection.toolId, rule.targetToolId],
            message: `${selection.toolId} 的依赖 ${rule.targetToolId} 没有可用版本。`,
          });
          continue;
        }
        selected.set(target.id, { toolId: target.id, versionId: targetVersion.id, reason: 'required' });
        changed = true;
      }
    }
  }

  for (const rule of catalog.compatibility) {
    const source = selected.get(rule.sourceToolId);
    const target = selected.get(rule.targetToolId);
    if (!source || !target) continue;
    const sourceVersion = catalog.tools.find((tool) => tool.id === source.toolId)
      ?.versions.find((version) => version.id === source.versionId)?.version;
    const targetVersion = catalog.tools.find((tool) => tool.id === target.toolId)
      ?.versions.find((version) => version.id === target.versionId)?.version;
    if (!sourceVersion || !targetVersion || !satisfies(sourceVersion, rule.sourceRange)) continue;

    const targetMatches = satisfies(targetVersion, rule.targetRange);
    const violated = rule.relation === 'conflicts' ? targetMatches : !targetMatches;
    if (violated) {
      diagnostics.push({
        code: `COMPATIBILITY_${rule.relation.toUpperCase()}`,
        severity: rule.severity,
        toolIds: [rule.sourceToolId, rule.targetToolId],
        message: rule.message,
      });
    }
  }

  return { selections: [...selected.values()], diagnostics };
}

export function sortSelections(catalog: Catalog, selections: Selection[]): Selection[] {
  const byTool = new Map(selections.map((selection) => [selection.toolId, selection]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const result: Selection[] = [];

  function visit(toolId: string) {
    if (visited.has(toolId)) return;
    if (visiting.has(toolId)) throw new Error(`Dependency cycle detected at ${toolId}`);
    visiting.add(toolId);

    const selection = byTool.get(toolId);
    const version = catalog.tools.find((tool) => tool.id === toolId)
      ?.versions.find((candidate) => candidate.id === selection?.versionId);
    if (version?.managedByToolId && byTool.has(version.managedByToolId)) visit(version.managedByToolId);
    for (const dependency of catalog.dependencies.filter(
      (rule) => rule.sourceToolId === toolId && rule.kind === 'requires' && byTool.has(rule.targetToolId),
    )) visit(dependency.targetToolId);

    visiting.delete(toolId);
    visited.add(toolId);
    if (selection) result.push(selection);
  }

  for (const selection of selections) visit(selection.toolId);
  return result;
}

export function validatePlanRequest(catalog: Catalog, request: InstallPlanRequest): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const selection of request.selections) {
    const tool = catalog.tools.find((candidate) => candidate.id === selection.toolId);
    if (!tool || !tool.versions.some((version) => version.id === selection.versionId)) {
      diagnostics.push({
        code: 'INVALID_SELECTION',
        severity: 'error',
        toolIds: [selection.toolId],
        message: `工具或版本不存在：${selection.toolId}/${selection.versionId}`,
      });
    }
  }
  return diagnostics;
}
