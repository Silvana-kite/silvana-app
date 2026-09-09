import { boolean, date, integer, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';

export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
});

export const tools = pgTable('tools', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description').notNull(),
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  homepageUrl: text('homepage_url').notNull(),
  iconKey: varchar('icon_key', { length: 100 }).notNull(),
  versionScheme: varchar('version_scheme', { length: 16 }).notNull(),
  status: varchar('status', { length: 16 }).default('active').notNull(),
});

export const toolVersions = pgTable('tool_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  toolId: uuid('tool_id').notNull().references(() => tools.id),
  version: varchar('version', { length: 64 }).notNull(),
  channel: varchar('channel', { length: 16 }).notNull(),
  releaseDate: date('release_date'),
  eolDate: date('eol_date'),
  recommended: boolean('recommended').default(false).notNull(),
  managedByToolId: uuid('managed_by_tool_id').references(() => tools.id),
  bundledTools: jsonb('bundled_tools').$type<Array<{ toolId: string; version: string }>>().default([]).notNull(),
  sourceRef: text('source_ref'),
}, (table) => [unique().on(table.toolId, table.version)]);

export const installRecipes = pgTable('install_recipes', {
  id: uuid('id').defaultRandom().primaryKey(),
  toolVersionId: uuid('tool_version_id').notNull().references(() => toolVersions.id),
  platform: varchar('platform', { length: 16 }).notNull(),
  architecture: varchar('architecture', { length: 16 }).notNull(),
  strategy: varchar('strategy', { length: 24 }).notNull(),
  manager: varchar('manager', { length: 24 }).notNull(),
  packageId: varchar('package_id', { length: 160 }).notNull(),
  arguments: jsonb('arguments').$type<string[]>().default([]).notNull(),
  verifyExecutable: varchar('verify_executable', { length: 120 }).notNull(),
  verifyArguments: jsonb('verify_arguments').$type<string[]>().default([]).notNull(),
  priority: integer('priority').default(100).notNull(),
  reviewStatus: varchar('review_status', { length: 16 }).default('draft').notNull(),
});

export const dependencyRules = pgTable('dependency_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceToolId: uuid('source_tool_id').notNull().references(() => tools.id),
  targetToolId: uuid('target_tool_id').notNull().references(() => tools.id),
  targetRange: varchar('target_range', { length: 80 }),
  kind: varchar('kind', { length: 16 }).notNull(),
  platforms: jsonb('platforms').$type<string[]>().default([]).notNull(),
  cancelable: boolean('cancelable').default(false).notNull(),
});

export const compatibilityRules = pgTable('compatibility_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  leftToolId: uuid('left_tool_id').notNull().references(() => tools.id),
  leftRange: varchar('left_range', { length: 80 }).notNull(),
  rightToolId: uuid('right_tool_id').notNull().references(() => tools.id),
  rightRange: varchar('right_range', { length: 80 }).notNull(),
  relation: varchar('relation', { length: 16 }).notNull(),
  severity: varchar('severity', { length: 16 }).notNull(),
  message: text('message').notNull(),
});

export const templates = pgTable('templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description').notNull(),
  scenario: varchar('scenario', { length: 24 }).notNull(),
  status: varchar('status', { length: 16 }).default('active').notNull(),
});

export const templateItems = pgTable('template_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  templateId: uuid('template_id').notNull().references(() => templates.id),
  toolId: uuid('tool_id').notNull().references(() => tools.id),
  toolVersionId: uuid('tool_version_id').references(() => toolVersions.id),
  required: boolean('required').default(false).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
}, (table) => [unique().on(table.templateId, table.toolId)]);

export const catalogReleases = pgTable('catalog_releases', {
  id: uuid('id').defaultRandom().primaryKey(),
  revision: varchar('revision', { length: 80 }).notNull().unique(),
  schemaVersion: integer('schema_version').notNull(),
  checksum: varchar('checksum', { length: 128 }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
});

export const syncRuns = pgTable('sync_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  source: varchar('source', { length: 80 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  candidateCount: integer('candidate_count').default(0).notNull(),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const contributions = pgTable('contributions', {
  id: uuid('id').defaultRandom().primaryKey(),
  anonymousTokenHash: varchar('anonymous_token_hash', { length: 128 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 16 }).default('pending').notNull(),
  moderationNote: text('moderation_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
});
