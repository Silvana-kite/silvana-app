import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) loadEnvFile(envFile);
// Include managed OS roots without disabling certificate validation.
setDefaultCACertificates([...new Set([...getCACertificates('default'), ...getCACertificates('system')])]);
