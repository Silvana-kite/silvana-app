export type Platform = 'windows' | 'macos' | 'linux';
export type Architecture = 'x64' | 'arm64';
export type ToolCategory =
  | 'runtime'
  | 'package-manager'
  | 'framework'
  | 'database'
  | 'editor'
  | 'cli'
  | 'container'
  | 'browser'
  | 'terminal'
  | 'api-client'
  | 'office' | 'pdf' | 'utility' | 'communication';
export type PackageManager = 'winget' | 'scoop' | 'choco' | 'brew' | 'apt' | 'volta' | 'npm' | 'official';

export interface ToolVersion {
  id: string;
  version: string;
  label?: string;
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
  downloadUrl?: string;
  supportedPlatforms?: Platform[];
  icon: string;
  diskMb: number;
  versions: ToolVersion[];
  recipes: InstallRecipe[];
  scenes?: Array<'frontend' | 'java' | 'python' | 'office'>;
  historyPolicy?: 'history' | 'latest-only';
}

export interface DependencyRule {
  sourceToolId: string;
  targetToolId: string;
  kind: 'requires' | 'recommends';
  targetRange?: string;
}

/** Discovery metadata is separate from the reviewed executable catalog. */
export interface ReleaseAsset {
  url: string;
  name: string;
  kind: 'binary' | 'source';
  /** Vendor identifiers are retained even when this application cannot install on them. */
  platform?: string;
  architecture?: string;
  sha256?: string;
  downloadStatus?: 'unknown' | 'available' | 'unavailable';
  yanked?: boolean;
  yankedReason?: string;
}
export interface ToolRelease {
  version: string;
  originalVersion: string;
  releaseDate?: string;
  channel: 'stable' | 'lts' | 'current' | 'eol';
  eolDate?: string;
  bundledNpm?: string;
  pageUrl: string;
  sourceUrl: string;
  assets: ReleaseAsset[];
  build?: string;
  releaseTrack?: string;
  isPrerelease?: boolean;
  isLts?: boolean;
  lifecycleKnown?: boolean;
  withdrawn?: boolean;
  withdrawnReason?: string;
}
export interface ToolReleasePage {
  quality?: import('./history.js').HistoryQuality;
  notice?: string;
  toolId: string;
  items: ToolRelease[];
  total: number;
  page: number;
  pageSize: number;
  revision: string;
  updatedAt: string | null;
  status: 'ready' | 'stale' | 'pending' | 'unavailable' | 'unsupported';
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
  scenario: 'frontend' | 'backend' | 'fullstack' | 'mobile' | 'data-science' | 'custom' | 'office';
  visible?: boolean;
  scene?: 'frontend' | 'java' | 'python' | 'office';
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
  versionLabel?: string;
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
