import { catalog } from '../../packages/catalog/src/index.ts';

// Build output is embedded in Rust. Remote catalog data never grants execution rights.
const tools = catalog.tools.map(tool => ({
  ...tool,
  versions: tool.versions.map(version => {
    const parts = version.version.split('.').map(Number);
    const range = version.version === 'stable' ? '*'
      : tool.id === 'python' ? `>=${parts[0]}.${parts[1]}.0, <${parts[0]}.${parts[1] + 1}.0`
      : `>=${parts[0]}.${parts[1] || 0}.${parts[2] || 0}, <${parts[0] + 1}.0.0`;
    return { ...version, acceptedRange: version.acceptedRange ?? range };
  }),
}));
process.stdout.write(JSON.stringify({ ...catalog, tools }));
