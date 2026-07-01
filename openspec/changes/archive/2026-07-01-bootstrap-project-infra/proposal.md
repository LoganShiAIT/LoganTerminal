## Why

LoganTerminal is described in its README as an open-source, cross-platform terminal for AI coding agents, and is committed to a permissive license (MIT or Apache-2.0). In practice the project is **not yet a git repository**, has **no `LICENSE` file** (README says "TBD"), and has **no CI** — the 28 Rust unit tests and the `tsc && vite build` pipeline are run by hand. This is fine for a solo prototype, but it blocks the project from being usable *as* an open-source project: nobody can legally use the code, nothing catches regressions between manual runs, and there is no commit history to blame a bug on. This change lays the missing foundation before further feature work compounds the problem.

## What Changes

- Initialize a git repository at the project root with an initial commit covering the current tree; add or extend `.gitignore` where needed (nothing new required — existing `.gitignore` already covers `node_modules`, `dist`, `src-tauri/target`, `Logan的文档/`).
- Add a top-level `LICENSE` file (MIT — see design.md for the rationale vs Apache-2.0).
- Set the `license` field in `package.json` and the `license` field in `src-tauri/Cargo.toml` to match.
- Add `.github/workflows/ci.yml` running two required jobs on every push and pull request to `main`:
  - **rust**: `cargo fmt --check` + `cargo test` in `src-tauri/` on `ubuntu-latest`, `macos-latest`, and `windows-latest`.
  - **frontend**: `npm ci` + `npm run build` (which is `tsc && vite build`) on `ubuntu-latest`.
- Update `README.md`:
  - Replace "License: TBD (MIT or Apache-2.0)" with the chosen license and a link to the `LICENSE` file.
  - Fix the two known-stale stats: "24 tests" → "28 tests"; "POSIX-escaped" → "escaped for the active shell (POSIX or PowerShell)". These were flagged in the `HandoffDocs/handoffs/project-review-fixes.md` handoff as "likely follow-up".
- **Non-goals** (deliberately out of scope; see design.md for rationale): pushing to GitHub, adding release automation, adding pre-commit hooks, adding lints beyond `cargo fmt --check`, adding frontend tests, adding code coverage reports, adding branch-protection settings, adding CLA/DCO tooling.

## Capabilities

### New Capabilities
- `project-infrastructure`: The set of repo-level primitives that make LoganTerminal legally usable and continuously verified — version control presence, declared license, and automated build/test on every change. Specifies the minimum guarantees the project makes to future contributors and users (e.g., "every commit on `main` has passing Rust tests on all three OSes").

### Modified Capabilities
<!-- None: no existing spec-level behavior is being changed. -->

## Impact

- **Affected files (created/modified)**: `.git/*` (new repo), `LICENSE` (new), `package.json` (license field), `src-tauri/Cargo.toml` (license field), `.github/workflows/ci.yml` (new), `README.md` (license section + two stat corrections).
- **Affected code**: None — no application source, no tests, no build config beyond the two `license` field entries. All 28 existing Rust tests and the frontend build must still pass after the change; CI codifies that as an ongoing requirement.
- **Dependencies**: No new runtime or build dependencies. CI adds a GitHub Actions requirement (already free for public repos) and the standard `dtolnay/rust-toolchain` + `actions/setup-node` actions.
- **Systems**: Introduces GitHub Actions as a required check. First-time cost per push ≈ 3–4 min wall-clock for the Rust matrix (biggest OS is Windows, which is slowest for Rust link steps). No production/runtime impact — the shipping Tauri binary is unchanged.
- **Handoff / docs impact**: Closes the "README stale relative to recent fixes" item in the `project-review-fixes` handoff. The `HandoffDocs/` directory itself is intentionally *not* touched by this change (its git-tracking policy is a separate decision the user has not made yet — see design.md).
