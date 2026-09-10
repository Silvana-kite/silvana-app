import { catalog } from './index.js';

const ids = new Set(catalog.tools.map((tool) => tool.id));
const errors: string[] = [];

if (ids.size !== catalog.tools.length) errors.push('工具 ID 必须唯一');
for (const tool of catalog.tools) {
  if (tool.versions.length && !tool.versions.some((version) => version.recommended)) errors.push(`${tool.id} 缺少推荐版本`);
  if (!tool.versions.length && (!tool.downloadUrl || tool.recipes.length)) errors.push(`${tool.id} 手动下载条目无效`);
  const toolVersionIds = new Set(tool.versions.map((version) => version.id));
  for (const recipe of tool.recipes) {
    if (!toolVersionIds.has(recipe.versionId)) errors.push(`${recipe.id} 引用了其他工具或未知版本`);
    if (!recipe.approved) errors.push(`${recipe.id} 未审核，不应进入内置目录`);
  }
}
for (const rule of catalog.dependencies) {
  if (!ids.has(rule.sourceToolId) || !ids.has(rule.targetToolId)) errors.push('依赖规则引用未知工具');
}
for (const template of catalog.templates) {
  for (const item of template.items) if (!ids.has(item.toolId)) errors.push(`${template.id} 引用了未知工具`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Catalog ${catalog.revision}: ${catalog.tools.length} tools, ${catalog.templates.length} templates`);
}
