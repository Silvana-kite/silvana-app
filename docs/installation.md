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

## Per-tool installation disks (Windows)

After a consented smart scan, each resolved tool has a disk selector. Bundled tools (npm with Node.js) follow their parent. The first scan defaults new choices to the system disk; an existing preference is retained even if the disk disconnects, and must then be corrected explicitly. Choices and disk-scan consent persist in the workspace. Capacity snapshots are never persisted: after consent, entering the environment center automatically scans when no valid result exists, including after restart. Re-scanning reuses consent; Settings can revoke it. Newly added tools require a destination. Review and progress show the requested disk and the observed program location.

The native request accepts an optional `installationTargets` map of tool IDs to drive roots. Empty maps retain the legacy platform behavior. Nonempty maps require Windows and a complete resolved selection; unknown keys, arbitrary directories, UNC paths and conflicting bundled destinations are rejected. Destination changes invalidate prepared sessions. Export is disabled for plans containing these choices, since the existing script exporter cannot enforce their location constraints.

The embedded recipe's `installationLocation` capability controls directory support. The initial reviewed custom-directory recipes are Windows Git and VS Code, using WinGet `--location` and native-generated `<drive>:\\Siilvana\\Apps\\<toolId>` paths. Other current recipes retain their default locations and block incompatible disk choices; they do not silently relocate. New capability entries require both installer parameter support and a way to verify the actual program. See [WinGet install options](https://learn.microsoft.com/en-us/windows/package-manager/winget/install): location support depends on the underlying installer.

Preflight rejects existing programs on another disk, unwritable custom directories and paths redirected to another disk. Runtime queries resolve Node, Python and Java locations; Volta shims and Maven/VS Code launchers are checked against their actual runtime or application files. Successful process exit and version checks alone cannot satisfy a chosen disk. Position failures stop the remaining steps; neither preflight nor retry migrates or uninstalls existing software.

Capacity is summed per destination (software plus 20% headroom and 2 GiB reserve per used disk). The OS temporary volume additionally reserves a download cache equal to the software estimate; when it is also a destination the reserve is merged. Unrelated full disks do not block installation. User settings, OS integration, databases and Docker images are outside the program-location constraint.

## Verification

- `pnpm check`: catalog validation, workspace type checking, unit tests, and builds.
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib`: native catalog, execution-boundary, architecture, and capacity-policy tests. The opt-in real-disk test stays ignored.
- `pnpm --filter @siilvana/desktop test:e2e:scenario`: five responsive viewports and the four-step browser workflow.
- `pnpm --filter @siilvana/desktop test:e2e:installation`: native IPC fixtures for preflight, failure, progress and retry; never installs software.
- `pnpm --filter @siilvana/desktop test:e2e:installation-locations`: Windows disk-selection fixtures at 390px and 1440px, offline targets, location conflicts, failure/retry, and script-export blocking. Defaults to the Vite server on port 1420 and accepts `SIILVANA_PREVIEW_URL`.
- `pnpm --filter @siilvana/desktop test:e2e:environment`: environment scanning fixtures and canvas checks.
- `pnpm --filter @siilvana/desktop test:e2e:scan-consent`: remembered authorization across reloads, automatic capacity refresh, recovery without repeated prompts, and revocation in Settings.
- `pnpm --filter @siilvana/desktop test:e2e:showroom`: runtime 3D asset checks.

Browser test artifacts are written under `artifacts/`. `SIILVANA_PREVIEW_URL` selects the scenario/showroom preview URL; `ENVIRONMENT_TEST_URL` selects the environment test URL.

The CI matrix builds and tests Rust on Windows, macOS, and Ubuntu. Actual installations must additionally be exercised in disposable native environments: a clean frontend template, an already-compatible installation, denied permission, insufficient capacity, failed installation, and retry. CI compilation and mocked browser results are not a claim that these real installation scenarios passed.
