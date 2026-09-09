# Native installation

The setup wizard has four steps: scenario, tools, review, installation. Selecting a scenario updates the selection without navigating. Desktop applications can execute reviewed plans; browsers can export scripts.

## Trust and execution

`tools/catalog/native-manifest.mjs` generates the catalog embedded by the Rust build. Native commands accept selected tool/version identifiers and an embedded catalog revision, never executable names or shell text from the renderer. Remote-only catalog revisions require an updated desktop build or script export.

`prepare_install` checks the native host, consented disk capacity, tool versions, and package-manager prerequisites. It returns a session identifier. `start_install` rechecks those conditions before serial execution. The application permits one task at a time and prevents closing its window during native operations.

Existing versions satisfying the catalog range are skipped. Every installed tool is checked again. A successful package-manager exit alone does not establish success. PATH discovery includes standard version-manager and platform installation locations.

Windows uses WinGet and native UAC interaction. Linux uses apt through polkit. Homebrew runs as the logged-in user; macOS cask installations requiring interaction use the system Terminal so passwords are never entered into application controls. Package-manager prerequisites link to official installation instructions.

Linux Volta is downloaded from the official v2.0.2 release, verified against an embedded SHA-256 for x64 or ARM64, and extracted only after verification. Linux VS Code uses Microsoft's `code` apt package; preflight links to the official repository setup when it is absent. Python and PostgreSQL templates use compatible distribution versions on Linux and display the actual apt candidate during preflight.

Cancellation stops queued steps after the current package-manager transaction finishes. Completed software is not uninstalled. Retrying runs preflight again and skips satisfied tools. Sessions and the latest 300 log lines are stored in the OS application data directory under `installation/session.json`. Interrupted sessions require a new consented check after application restart.

Installation verifies tools and executable paths. It does not initialize databases, launch Docker services, or configure application projects.

## Verification

- `pnpm check`: catalog validation, workspace type checking, unit tests, and builds.
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib`: native catalog, execution-boundary, architecture, and capacity-policy tests. The opt-in real-disk test stays ignored.
- `pnpm --filter @siilvana/desktop test:e2e:scenario`: five responsive viewports and the four-step browser workflow.
- `pnpm --filter @siilvana/desktop test:e2e:installation`: native IPC fixtures for preflight, failure, progress and retry; never installs software.
- `pnpm --filter @siilvana/desktop test:e2e:environment`: environment scanning fixtures and canvas checks.
- `pnpm --filter @siilvana/desktop test:e2e:showroom`: runtime 3D asset checks.

Browser test artifacts are written under `artifacts/`. `SIILVANA_PREVIEW_URL` selects the scenario/showroom preview URL; `ENVIRONMENT_TEST_URL` selects the environment test URL.

The CI matrix builds and tests Rust on Windows, macOS, and Ubuntu. Actual installations must additionally be exercised in disposable native environments: a clean frontend template, an already-compatible installation, denied permission, insufficient capacity, failed installation, and retry. CI compilation and mocked browser results are not a claim that these real installation scenarios passed.
