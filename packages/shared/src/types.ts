export type Platform = 'windows' | 'macos' | 'linux';
export type Architecture = 'x64' | 'arm64';
export type ToolCategory =
  | 'runtime'
  | 'package-manager'
  | 'framework'
  | 'database'
  | 'editor'
  | 'cli'
  | 'container';
export type PackageManager = 'winget' | 'scoop' | 'choco' | 'brew' | 'apt' | 'volta' | 'npm' | 'official';

export interface ToolVersion {
  id: string;
  version: string;
  channel: 'lts' | 'stable' | 'current' | 'eol';
  recommended?: boolean;
  acceptedRange?: string;
  eolDate?: string;
  managedByToolId?: string;
  bundledTools?: Array<{ toolId: string; version: string }>;
}

export interface InstallRecipe {
  id: string;
  versionId: string;
  platform: Platform;
  architecture: Architecture | 'any';
  strategy: 'system-package' | 'version-manager' | 'package-binary' | 'official-installer';
  manager: PackageManager;
  packageId: string;
  arguments?: string[];
  verify: { executable: string; args: string[] };
  approved: boolean;
  /** Only reviewed Windows recipes may opt into custom installation directories. */
  installationLocation?: { kind: 'directory'; executable: string } | { kind: 'fixed' };
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  homepage: string;
  icon: string;
  diskMb: number;
  versions: ToolVersion[];
  recipes: InstallRecipe[];
}

export interface DependencyRule {
  sourceToolId: string;
  targetToolId: string;
  kind: 'requires' | 'recommends';
  targetRange?: string;
}

export interface CompatibilityRule {
  sourceToolId: string;
  sourceRange: string;
  targetToolId: string;
  targetRange: string;
  relation: 'requires' | 'conflicts' | 'recommends';
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface EnvironmentTemplate {
  id: string;
  name: string;
  description: string;
  scenario: 'frontend' | 'backend' | 'fullstack' | 'mobile' | 'data-science' | 'custom';
  items: Array<{ toolId: string; versionId?: string }>;
}

export interface Catalog {
  schemaVersion: number;
  revision: string;
  generatedAt: string;
  tools: Tool[];
  dependencies: DependencyRule[];
  compatibility: CompatibilityRule[];
  templates: EnvironmentTemplate[];
}

export interface Selection {
  toolId: string;
  versionId: string;
  reason?: 'explicit' | 'required' | 'bundled';
}

export interface Diagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  toolIds: string[];
  message: string;
}

export interface ProcessSpec {
  executable: string;
  args: string[];
}

export type InstallAction =
  | { kind: 'process'; process: ProcessSpec }
  | { kind: 'approved-script'; scriptId: 'volta-unix' };

export interface InstallStep {
  id: string;
  toolId: string;
  toolName: string;
  versionId: string;
  version: string;
  manager: PackageManager;
  strategy: InstallRecipe['strategy'];
  reason: 'explicit' | 'required';
  action: InstallAction;
  verify: ProcessSpec;
}

export interface InstallPlanRequest {
  platform: Platform;
  architecture: Architecture;
  preferredManagers: PackageManager[];
  selections: Selection[];
}

export interface InstallPlan {
  catalogRevision: string;
  selections: Selection[];
  steps: InstallStep[];
  diagnostics: Diagnostic[];
  estimatedDiskMb: number;
  script: { shell: 'powershell' | 'bash'; content: string };
}
