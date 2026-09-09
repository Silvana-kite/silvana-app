import type { Catalog } from './types.js';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isCatalog(value: unknown): value is Catalog {
  if (!record(value)
    || !Number.isInteger(value.schemaVersion)
    || typeof value.revision !== 'string'
    || typeof value.generatedAt !== 'string'
    || !Array.isArray(value.tools)
    || !Array.isArray(value.dependencies)
    || !Array.isArray(value.compatibility)
    || !Array.isArray(value.templates)) return false;

  const toolIds = new Set<string>();
  for (const candidate of value.tools) {
    if (!record(candidate)
      || typeof candidate.id !== 'string'
      || typeof candidate.name !== 'string'
      || typeof candidate.description !== 'string'
      || typeof candidate.category !== 'string'
      || typeof candidate.homepage !== 'string'
      || typeof candidate.icon !== 'string'
      || typeof candidate.diskMb !== 'number'
      || !Array.isArray(candidate.versions)
      || !Array.isArray(candidate.recipes)
      || toolIds.has(candidate.id)) return false;
    toolIds.add(candidate.id);

    const versionIds = new Set<string>();
    for (const version of candidate.versions) {
      if (!record(version)
        || typeof version.id !== 'string'
        || typeof version.version !== 'string'
        || typeof version.channel !== 'string'
        || versionIds.has(version.id)) return false;
      versionIds.add(version.id);
    }
    for (const recipe of candidate.recipes) {
      if (!record(recipe)
        || typeof recipe.id !== 'string'
        || !versionIds.has(String(recipe.versionId))
        || typeof recipe.platform !== 'string'
        || typeof recipe.architecture !== 'string'
        || typeof recipe.strategy !== 'string'
        || typeof recipe.manager !== 'string'
        || typeof recipe.packageId !== 'string'
        || (recipe.arguments !== undefined && !strings(recipe.arguments))
        || recipe.approved !== true
        || !record(recipe.verify)
        || typeof recipe.verify.executable !== 'string'
        || !strings(recipe.verify.args)) return false;
    }
  }

  const rulesReferenceKnownTools = [...value.dependencies, ...value.compatibility].every((candidate) =>
    record(candidate)
    && typeof candidate.sourceToolId === 'string'
    && typeof candidate.targetToolId === 'string'
    && toolIds.has(candidate.sourceToolId)
    && toolIds.has(candidate.targetToolId));
  if (!rulesReferenceKnownTools) return false;

  return value.templates.every((candidate) =>
    record(candidate)
    && typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.description === 'string'
    && typeof candidate.scenario === 'string'
    && Array.isArray(candidate.items)
    && candidate.items.every((item) => record(item) && typeof item.toolId === 'string' && toolIds.has(item.toolId)));
}

export function parseCatalog(value: unknown): Catalog {
  if (!isCatalog(value)) throw new Error('Catalog payload failed schema validation');
  return value;
}
