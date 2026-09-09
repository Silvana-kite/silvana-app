import type { Architecture, Platform, Tool } from './types.js';

export function platformVersion(tool: Tool, platform: Platform, architecture: Architecture) {
  const available = tool.versions.filter(version => tool.recipes.some(recipe => recipe.approved && recipe.versionId === version.id && recipe.platform === platform && (recipe.architecture === 'any' || recipe.architecture === architecture)));
  return available.find(version => version.recommended) ?? available[0] ?? tool.versions.find(version => version.recommended) ?? tool.versions[0];
}
