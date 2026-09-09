# Environment adaptation center

The `/environment` page uses the existing software catalog and dependency resolver. Its recommendations describe catalog support, not an inventory of software already installed on the computer.

## Device and storage

The Tauri `device_info` command reads CPU information without disk access. Windows uses `IsWow64Process2` to identify the native host; macOS checks Rosetta translation before normalizing the architecture. Unknown architectures stay unknown. Windows 10 version 1709 or newer is required by the native architecture query.

The app consent dialog must be accepted before `scan_disks` is invoked. It enumerates all mounted local volumes exposed by the OS, including data partitions and attached removable drives, and queries only capacity metadata. Results are deduplicated by mount point, sorted, and displayed individually. The `installationTarget` flag identifies the system and user-directory volumes; only those constrain installation. A full unrelated data drive does not block installation. The disk overview displays every scanned volume, with its drive or mount identity, available and total capacity, and installation/cache roles. It does not collapse multiple disks into one capacity value. Space warnings identify each installation-related volume that lacks capacity. macOS resolves standard writable paths against its data volume. Unmounted partitions are not installation destinations. Capacity is an estimate for default package-manager locations, not a guarantee about custom installer destinations.

Required capacity on each installation volume is `ceil(estimatedDiskMb * 1024^2 * 1.2) + 2 * 1024^3`, including resolved dependencies. Disk snapshots are memory-only. Disk-scan consent is persisted in workspace preferences after approval, reused for manual re-scans, and can be revoked in Settings. Scan activity summaries include the total disk count and are persisted through the existing workspace store.

Web browsers never substitute origin storage quota for disk capacity. They can browse recommendations and explicitly enter manual configuration, which labels disk space as unverified.

## Export checks

Smart configuration persists its mode with the existing v1 workspace state; older state without that field defaults to manual. A reload restores the mode and remembered consent, then automatically refreshes disk capacity when entering the environment center. Older state without a consent preference still requires the initial approval. Target changes invalidate the scan, selected-software changes recalculate the budget, and both copy and download requery capacity before exporting. The export is canceled if the plan changes while verification is running.

## Verification

- `pnpm --filter @siilvana/desktop test`
- `pnpm --filter @siilvana/desktop build`
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib`
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib live_disk_capacity -- --ignored --nocapture` explicitly reads this machine's disk metadata.
- With the web dev server running: `node desktop/e2e/environment.mjs`. Set `ENVIRONMENT_TEST_URL` to use a different server. Requires local Chrome.

Browser verification writes screenshots to `artifacts/environment/`, including desktop, tablet, mobile, narrow mobile, 8K, permission, success, and insufficient-space states. Native success/error fixtures exist only inside the test browser. There is no production demo-data switch. Canvas checks verify nonblank rendering and animation changes. Native installation is documented in `installation.md`.

Windows native reads can be tested locally. macOS and Linux native behavior still require checks on those operating systems; browser fixtures do not replace those checks.
