# Software history and the official-site browser

The environment center includes 23 frontend-related system tools: Node.js, npm, pnpm, Yarn, Bun, Deno, Volta, fnm, nvm, nvm-windows, Git, GitHub CLI, GitHub Desktop, VS Code, WebStorm, Chrome, Edge, Firefox, PowerShell, Windows Terminal, Postman, and Bruno, plus the existing Docker entry. Java, Python, Maven and PostgreSQL remain available. Project dependencies are not added.

Discovery and execution are separate. A release scraped from an official source does not gain an executable recipe. Only an exact version with an existing reviewed platform recipe can be selected for installation. npm remains bundled with Node. Tools without reviewed recipes have working history and website controls but cannot add an empty installation step.

## Run the real pipeline

Use Node 24 and PostgreSQL (local or a Neon PostgreSQL connection string). Copy `server/.env.example` to `server/.env` and configure `DATABASE_URL`. Optional `GITHUB_TOKEN` raises the anonymous API limit; it is used only for requests to `api.github.com`. For a local PostgreSQL instance, a connection string such as `postgresql://user:password@127.0.0.1:5432/siilvana` is supported. The Nest server reads `server/.env`; explicit process environment variables take precedence.

```sh
pnpm --filter @siilvana/shared build
pnpm --filter @siilvana/catalog build
pnpm --filter @siilvana/server build
pnpm --filter @siilvana/server db:migrate
pnpm --filter @siilvana/server catalog:sync --all
pnpm --filter @siilvana/server dev
```

To synchronize a single source, use `catalog:sync --tools=node --all`. `--force` bypasses the 24-hour due time or backoff for explicitly requested operational retries. It does not bypass the database lock. An initial full run can take several minutes and should run as the CLI task, not in a short-lived web request. Run the command again to resume checkpoints. A `partial` result or a nonzero exit code must be investigated; do not report it as complete coverage.

Set the frontend's `VITE_API_URL` to the Nest `/v1` base URL. Development defaults to `http://localhost:3000/v1`. If a different frontend origin is used, add it to `DESKTOP_ORIGIN`. Production builds need an explicit API URL. The application still provides its reviewed offline catalog when history is unavailable.

The authenticated `GET /internal/cron/catalog-sync` executes the same Nest service with a 45-second work budget. Existing daily Vercel scheduling is retained. `Authorization: Bearer <CRON_SECRET>` is required; public list/search requests never trigger crawling.

## Storage and source behavior

`release_history` stores published records by tool/version; `release_sources` stores the independent history revision, freshness, lease, retry time and pagination checkpoint; `release_page_cache` stores conditional-request validators, response bodies, checksums and parser metadata. `sync_runs` records successful and failed runs. The additive migration is idempotent and does not seed or modify reviewed install recipes.

A PostgreSQL advisory lock permits one crawler coordinator across instances, with two workers and a one-second same-host cooldown. The oldest due sources run first so a short cron budget cannot starve tools at the end of the catalog. Per-source leases expire after 90 seconds and renew after each page. HTTP requests time out after 10 seconds, bodies are limited to 32 MiB, redirects stay within registered official source hosts, and failures honor Retry-After/rate-reset or exponential backoff. TLS uses normal Node and OS trust roots; certificate validation is never disabled.

Each tool publishes atomically after all its pages parse. A failure retains both the last published history and the restart checkpoint. Completed history is retained when a vendor shortens its feed. Empty or malformed source results cannot replace published data. Browser/API reads do not update the crawler's request cache.

Sources are declared in `server/src/modules/releases/sources.ts`:

- Node: official distribution index and release lifecycle schedule, including bundled npm and declared platforms.
- npm, pnpm and both Yarn CLI generations: official registry package metadata.
- GitHub projects: official repositories and every release page; GitHub Desktop's `release-` tags and Bun's `bun-v` tags are normalized.
- VS Code: official tags and documented exact-version download URLs. Tags are sorted by version, not the API's return order.
- Git: the official kernel.org Git archive includes the very old releases directly; a nonexistent `historical/` path is not used.
- WebStorm, Edge and Firefox: official vendor release metadata/archives, with Edge's archived stable release notes.
- Chrome: Google's VersionHistory API, including page tokens. Network failures are recorded and surfaced without substituting unrelated Chromium/CfT builds.
- Postman: the official `mkt.cdn.postman.com/www-next/release-notes/app-release-notes.json` feed used by its website.
- Docker: official Desktop release-note sections and their download links.

Only public official history is discoverable. Older installer assets may be removed by the vendor. Release records, source archives and binary resources are labeled separately. Generic package-manager aliases (`stable`, `system`) are not presented as pinned historical binaries. Downloads are not probed for every historical asset during a sync, to avoid thousands of additional requests.

## API and desktop behavior

`GET /v1/tools/:id/versions?q=12.22.12&page=1&pageSize=50` supports optional platform/architecture filtering and ETag/304. Missing tools return 404; invalid pagination returns 400. The response includes `status`, `revision`, `updatedAt`, `total`, and `items`. Status distinguishes ready, stale, pending, unavailable and unsupported histories. CORS exposes ETag.

The searchable version dialog retains supported install choices even when the API fails. Client caches are persisted per API/tool/query/page, bounded to 100 query pages and a conservative 2 MiB storage budget, reused for five minutes, and labeled as partial offline history on network failure. Refresh reads the server; it does not trigger official-site requests.

On desktop, official links open a remote child WebView inside the main window. A local toolbar provides navigation, refresh, address, close and download status. HTTPS popup links stay in this view. Downloads use a native save dialog and never execute the downloaded file. Hiding the view allows in-progress downloads to finish. Remote content has no Tauri capability grant and browser-control commands additionally check the calling WebView and its origin. Tauri 2.11.5's `unstable` child-WebView feature is pinned for this implementation.

## Verification

```sh
pnpm check
cargo test --manifest-path desktop/src-tauri/Cargo.toml
```

PostgreSQL integration tests require a dedicated database named `siilvana_release_test` and `RELEASE_TEST_DATABASE_URL`. These tests truncate only that explicit test database's history tables, then verify publication, reads after service recreation, ETag reuse, failure preservation, pagination, duplicate workers, expired leases and backoff. The workspace CI job provisions PostgreSQL 18 and always runs these tests. Local runs without that variable explicitly skip them.

With real collected data and running services, run `pnpm --filter @siilvana/desktop test:e2e:history`. Defaults are frontend `http://127.0.0.1:1422` and API `http://127.0.0.1:3100/v1`; override with `SIILVANA_PREVIEW_URL` and `SIILVANA_API_URL`. Bind the test Vite server explicitly using `dev:web --port 1422 --host 127.0.0.1`, set its `VITE_API_URL`, and include that origin in the server's `DESKTOP_ORIGIN`. The test verifies the real Node 12 record, HTTP 304, validation, old-version display and responsive layouts. Evidence is written under `artifacts/release-history/`, which is not committed.

For native Windows checks, start Tauri with `tauri dev --no-watch --config <absolute path to desktop/e2e/native.config.json>`. This test configuration uses a separate app identifier/profile and a loopback CDP port. Run `node e2e/native-history.mjs` from `desktop` to check actual child-WebView loading, popup reuse, back navigation, and rejection of remote IPC. For download verification, use a fresh instance without attaching a browser debugger, open the tools step, and run `desktop/e2e/native-download-ui.ps1 -NativeProcessId <test PID>`. It selects Node 12 through the native accessibility interface, activates the official archive link, fills only its matching save dialog, and checks the file against the official SHA-256. The helper refuses to overwrite an existing test archive. The lower-level `save-native-download.ps1 -Resume` can finish a test dialog that is already open. Keeping download verification separate avoids the browser automation framework's download interception. macOS/Linux verification must be recorded separately from Windows.
