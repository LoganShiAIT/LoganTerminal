## ADDED Requirements

### Requirement: Repository is version-controlled

The project root SHALL be a git repository with at least one commit at the point this change is considered complete.

#### Scenario: git recognizes the repo

- **WHEN** `git rev-parse --is-inside-work-tree` is run from the project root
- **THEN** it exits 0 and prints `true`

#### Scenario: initial commit exists

- **WHEN** `git log --oneline` is run from the project root
- **THEN** it prints at least one commit, and the oldest commit's message begins with `chore: initial commit`

#### Scenario: HandoffDocs is intentionally left unresolved

- **WHEN** `git ls-files HandoffDocs/` and `git check-ignore -v HandoffDocs/` are both run against the initial commit
- **THEN** `git ls-files HandoffDocs/` prints nothing (HandoffDocs is untracked) AND `git check-ignore -v HandoffDocs/` exits non-zero with no output (HandoffDocs is not gitignored either) — preserving the deferred privacy choice per design.md § D4

### Requirement: License is declared

The project SHALL declare a single SPDX license identifier of `MIT` in three places, and the `LICENSE` file SHALL contain the canonical MIT license text.

#### Scenario: LICENSE file is present and canonical

- **WHEN** the file `LICENSE` at the project root is inspected
- **THEN** it exists, is a plain text file, contains the string `MIT License`, and contains a copyright line for the current year and the project's owner

#### Scenario: package.json declares MIT

- **WHEN** `node -e "console.log(require('./package.json').license)"` is run from the project root
- **THEN** it prints `MIT`

#### Scenario: Cargo.toml declares MIT

- **WHEN** the `[package]` section of `src-tauri/Cargo.toml` is parsed
- **THEN** it contains `license = "MIT"`

#### Scenario: README no longer says TBD

- **WHEN** `grep -i "License" README.md` is run
- **THEN** the output references `MIT` and does NOT contain the string `TBD`

### Requirement: Continuous integration workflow is configured

The project SHALL contain a GitHub Actions workflow file that, when the repository is hosted on GitHub, runs the Rust test suite on Linux, macOS, and Windows, and runs the frontend build on Linux, for every push and pull request targeting `main`.

#### Scenario: Workflow file exists at the expected path

- **WHEN** the file `.github/workflows/ci.yml` is inspected
- **THEN** it exists and is valid YAML

#### Scenario: Workflow triggers on push and pull_request to main

- **WHEN** the parsed workflow YAML is inspected
- **THEN** its top-level `on` key includes both `push` and `pull_request`, and each has `branches: [main]`

#### Scenario: Rust job runs the full matrix

- **WHEN** the parsed workflow YAML is inspected
- **THEN** it contains a job that runs `cargo fmt --check` and `cargo test` in the `src-tauri/` working directory, with `strategy.matrix.os` including `ubuntu-latest`, `macos-latest`, and `windows-latest`

#### Scenario: Frontend job runs on Linux

- **WHEN** the parsed workflow YAML is inspected
- **THEN** it contains a job that runs `npm ci` followed by `npm run build`, using `runs-on: ubuntu-latest`

#### Scenario: Existing tests pass under the workflow's commands

- **WHEN** `cargo fmt --check` and `cargo test` are run in `src-tauri/`, and `npm ci` + `npm run build` are run at the project root, in the same order the workflow would run them
- **THEN** all four commands exit 0 — so the workflow's guarantees are not immediately violated on first CI run

### Requirement: README accurately reflects current project state

The project's `README.md` SHALL NOT contain the specific stale claims that were documented as "known-stale" prior to this change: the test count, the drag-drop escaping description, and the license status.

#### Scenario: README reports the actual test count

- **WHEN** the count of `#[test]`-annotated functions under `src-tauri/src/` is compared to any test-count claim in `README.md`
- **THEN** the two numbers agree (currently 28)

#### Scenario: README describes cross-platform escaping

- **WHEN** the README's description of dragged-file path insertion is inspected
- **THEN** it describes escaping as platform-aware (POSIX or PowerShell depending on the active shell), and does NOT claim POSIX-only escaping

#### Scenario: README license section matches the LICENSE file

- **WHEN** the README's "License" section is inspected
- **THEN** it identifies the license as MIT and links to (or otherwise references) the `LICENSE` file
