## 1. License declaration

- [x] 1.1 Create `LICENSE` at the project root containing the canonical MIT license text, with copyright line `Copyright (c) 2026 Logan` (adjust name if Logan prefers a different attribution; default per README author section is just "Logan")
- [x] 1.2 Add `"license": "MIT"` to `package.json` (place it next to `"version"` for consistency with npm conventions)
- [x] 1.3 Add `license = "MIT"` under the `[package]` section of `src-tauri/Cargo.toml`
- [x] 1.4 Run `cargo check` in `src-tauri/` to confirm the manifest still parses (no expected failures — Cargo accepts the SPDX identifier natively)
- [x] 1.5 Run `node -e "console.log(require('./package.json').license)"` and confirm output is `MIT`

## 2. CI workflow

- [x] 2.1 Create `.github/workflows/ci.yml` with two jobs:
  - `rust`: `strategy.matrix.os` = `[ubuntu-latest, macos-latest, windows-latest]`, checks out repo, sets up Rust via `dtolnay/rust-toolchain@stable` with `components: rustfmt`, runs `cargo fmt --check` and `cargo test` with `working-directory: src-tauri`
  - `frontend`: `runs-on: ubuntu-latest`, checks out repo, sets up Node via `actions/setup-node@v4` with `node-version: 20` and `cache: npm`, runs `npm ci` and `npm run build`
  - Both triggered by `on: { push: { branches: [main] }, pull_request: { branches: [main] } }`
- [x] 2.2 Locally verify the workflow's Rust commands: `cd src-tauri && cargo fmt --check && cargo test` — both must exit 0. If `cargo fmt --check` fails, run `cargo fmt` and include the formatting fixes in the initial commit rather than skipping the check
- [x] 2.3 Locally verify the workflow's frontend commands: from the project root, `npm ci && npm run build` — both must exit 0. If `npm ci` complains about a missing `package-lock.json`, generate it with `npm install` first, then re-run `npm ci` to confirm the lockfile is reproducible
- [x] 2.4 Lint the workflow file with `npx --yes @action-validator/cli .github/workflows/ci.yml` (or just visually confirm valid YAML if that tool is unavailable — the workflow won't run locally regardless)

## 3. README corrections

- [x] 3.1 Update the "License" section (currently line 76-78) to say `MIT — see [LICENSE](LICENSE).` and remove the "TBD" wording
- [x] 3.2 Update the "Unit tests" line under "Develop" to say "28 tests" instead of "24 tests" (verify current count via `grep -rE "#\[test\]" src-tauri/src | wc -l` — should print 28)
- [x] 3.3 Update the drag-drop description (in "What works today") to describe cross-platform escaping — replace "paths are POSIX-escaped" with "paths are escaped for the active shell (POSIX quoting on macOS/Linux, PowerShell quoting on Windows)"
- [x] 3.4 Re-read the README end-to-end and note any additional drift discovered during the pass. If any are found, add them to `HandoffDocs/handoffs/project-review-fixes.md` as follow-ups rather than expanding this change's scope

## 4. Git initialization and initial commit

- [ ] 4.1 Run `git init` at the project root. Confirm the resulting default branch: `git branch --show-current`. If it prints `master`, run `git branch -m main` to rename
- [ ] 4.2 Configure the local repo's `user.name` and `user.email` if not already set globally, so the initial commit isn't ambiguous. (Ask Logan for values if unclear — do NOT invent them)
- [ ] 4.3 Stage everything the current `.gitignore` allows, except `HandoffDocs/`. Concrete steps: `git add -A`, then `git reset HEAD HandoffDocs/` to unstage that directory. Verify with `git status`: `HandoffDocs/` should be listed as an untracked directory, everything else should be staged
- [ ] 4.4 Confirm no accidentally-staged secrets or binaries by inspecting `git diff --cached --stat` (spot-check any surprising path, especially anything under `src-tauri/icons/` or hidden dotfiles)
- [ ] 4.5 Create the initial commit: `git commit -m "chore: initial commit"`. Verify with `git log --oneline` — exactly one commit

## 5. Verification against the spec

- [ ] 5.1 Confirm all scenarios in `openspec/changes/bootstrap-project-infra/specs/project-infrastructure/spec.md` pass:
  - Requirement 1: git repo exists, initial commit exists, `HandoffDocs/` is untracked-and-unignored
  - Requirement 2: `LICENSE` exists, `package.json` license is `MIT`, `Cargo.toml` license is `MIT`, README no longer says `TBD`
  - Requirement 3: `.github/workflows/ci.yml` exists, triggers on push+PR to main, Rust matrix hits three OSes, frontend job on Linux, `cargo fmt --check` + `cargo test` + `npm ci` + `npm run build` all pass locally
  - Requirement 4: test count in README matches `grep`, escaping description mentions PowerShell/POSIX, license section links to `LICENSE`
- [ ] 5.2 Run `npx --no-install openspec validate bootstrap-project-infra` and confirm it reports the change is valid

## 6. HandoffDocs/ privacy prompt (deferred decision from design.md § D4)

- [ ] 6.1 Ask Logan the deferred question: should `HandoffDocs/` be treated as private (added to `.git/info/exclude`) or shared (staged and committed)? Do not decide unilaterally
- [ ] 6.2 If Logan chooses **private**, append `HandoffDocs/` to `.git/info/exclude`, verify with `git check-ignore -v HandoffDocs/` (should now match), and note the decision in `HandoffDocs/handoffs/openspec-workflow-init.md` progress log
- [ ] 6.3 If Logan chooses **shared**, stage the directory (`git add HandoffDocs/`) and create a second commit `docs: track handoff coordination notes`. Verify with `git log --oneline` — two commits now. Update the same handoff file
- [ ] 6.4 If Logan wants to keep deferring, leave `HandoffDocs/` untracked-and-unignored and note that in the handoff file too. The spec's "Requirement 1 § HandoffDocs is intentionally left unresolved" scenario continues to pass in that case

## 7. Handoff sync (recording what was done)

- [ ] 7.1 Update `HandoffDocs/handoffs/project-review-fixes.md`'s "Findings and Decisions" section: mark the "README stale" and "no git repo" items as resolved, referencing the `bootstrap-project-infra` change
- [ ] 7.2 Update `HandoffDocs/handoff.md` — move or add a Done row for `bootstrap-project-infra` (Result: "git repo initialized, MIT license, GitHub Actions CI workflow, README corrections", Follow-up: "push to GitHub when ready; HandoffDocs/ privacy decision was <recorded outcome>")
- [ ] 7.3 Run `npx --no-install openspec archive bootstrap-project-infra` to move the change into `openspec/changes/archive/` after the initial commit lands (per OpenSpec workflow)
