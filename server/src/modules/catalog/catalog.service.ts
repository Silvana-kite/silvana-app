import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { catalog } from '@siilvana/catalog';
import { createInstallPlan, type InstallPlanRequest } from '@siilvana/shared';

@Injectable()
export class CatalogService {
  readonly catalog = catalog;
  readonly etag = `"catalog-${createHash('sha256').update(JSON.stringify(catalog)).digest('hex').slice(0, 16)}"`;

  listTools(query?: string, category?: string, platform?: string) {
    const normalized = query?.trim().toLocaleLowerCase();
    return this.catalog.tools.filter((tool) => {
      const matchesQuery = !normalized || `${tool.name} ${tool.description}`.toLocaleLowerCase().includes(normalized);
      const matchesCategory = !category || tool.category === category;
      const matchesPlatform = !platform || tool.recipes.some((recipe) => recipe.platform === platform);
      return matchesQuery && matchesCategory && matchesPlatform;
    });
  }

  createPlan(request: InstallPlanRequest) {
    return createInstallPlan(this.catalog, request);
  }

  recommend(scenario: string) {
    const template = this.catalog.templates.find((candidate) => candidate.scenario === scenario)
      ?? this.catalog.templates.find((candidate) => candidate.id === 'custom');
    return { template, catalogRevision: this.catalog.revision };
  }
}

