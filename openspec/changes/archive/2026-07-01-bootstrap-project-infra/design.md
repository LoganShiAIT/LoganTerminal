## Context

LoganTerminal exists as a working directory at `/Users/2497088971qq.com/Documents/GitHub/LoganTerminal` but not as a git repository. Three factual states relevant to this design:

1. **No `.git/`**: verified via `git status` returning `fatal: not a git repository`. No commit history exists locally.
2. **License is undecided**: `README.md` line 78 says `TBD (MIT or Apache-2.0)`. `package.json` has no `license` field. `src-tauri/Cargo.toml` has no `license` field.
3. **CI does not exist**: no `.github/` directory. The 28 Rust unit tests (`cargo test`) and the frontend build (`tsc && vite build`) are only ever run when someone runs them by hand.

The project already has a `.gitignore` that covers `node_modules`, `dist`, `src-tauri/target`, and `Logan的文档/`. `HandoffDocs/` is currently *not* gitignored, and its privacy policy (private/local vs shared/team) has never been made explicit for this project.

The existing `HandoffDocs/handoffs/project-review-fixes.md` handoff already flags "README stale" and "No git repository detected" as follow-ups. This change addresses both.

## Goals / Non-Goals

**Goals:**
- Every commit on the eventual `main` branch has passing Rust tests on Linux, macOS, and Windows, and a passing frontend build on Linux — enforced by CI, not by trust.
- The project has a single, unambiguous license declared in three places that stay in sync: `LICENSE` file, `package.json`, `Cargo.toml`.
- Local git history exists so future bugs can be bisected and blamed.
- README claims about the project (test count, escaping behavior, license) match reality.

**Non-Goals:**
- **Not pushing to GitHub.** The remote may or may not exist; user has not requested a push. `git remote add` and `git push` are user actions, not agent actions. CI *will* be added to `.github/workflows/`, but it will not run until the repo lands on GitHub — that's fine, the workflow file is a lossless artifact until then.
- **Not deciding the `HandoffDocs/` privacy policy.** The `multi-agent-handoff` skill says "Choose private/local or shared/team policy first" and the user has not chosen. Leaving `HandoffDocs/` out of both `.gitignore` and this change's initial commit is the safe default (see Decisions § HandoffDocs privacy).
- **Not adding release automation, pre-commit hooks, coverage reports, branch protection, CLA tooling, or frontend tests.** Each is a defensible next step but each is its own change. This change is deliberately narrow: "make the project a legit open-source project" and no more.
- **Not adding lints beyond `cargo fmt --check`.** `cargo clippy` is a plausible next step but has a real false-positive-fatigue cost on a small codebase; skip for now.
- **Not writing new tests.** CI runs what exists; growing the test suite is out of scope.

## Decisions

### D1: License — MIT (over Apache-2.0 or dual MIT/Apache-2.0)

**Chosen:** MIT.

**Rationale:**
- README already scopes the choice to MIT or Apache-2.0 — GPL and other copyleft options were explicitly rejected by the user (see stored project memory).
- MIT is the dominant license in the Node.js ecosystem; every dependency in `package.json` is MIT or MIT-compatible, so a MIT-licensed project has zero downstream license friction.
- Rust ecosystem is more evenly split (MIT/Apache-2.0 dual is common for crates intended for wide reuse). This project is an *application*, not a reusable library, so dual-licensing brings no practical benefit and roughly 10× the license text.
- MIT is ~170 words; Apache-2.0 is ~1,500 words including required NOTICE handling. For a solo project, MIT's simplicity is a feature.
- Apache-2.0's main advantage over MIT is its explicit patent grant. For a terminal emulator with no patented tech, this is not a meaningful risk in either direction.

**Alternatives considered:**
- **Apache-2.0**: rejected — patent grant not needed here, and the extra ceremony (NOTICE file, per-file headers if strict) doesn't fit a solo hobby project.
- **Dual MIT/Apache-2.0**: rejected — this is application code, not a library; downstream consumers won't be picking one over the other.
- **BSD-3-Clause**: rejected — offers no advantage over MIT for this project.

**Reversible?** Yes. If the project ever ships a library crate that wants to match the Rust ecosystem's dual-license norm, adding an `Apache-2.0` file and updating `Cargo.toml` to `MIT OR Apache-2.0` is a mechanical follow-up. Downgrading from a more permissive to a less permissive license is what's hard; MIT → dual is easy.

### D2: CI matrix — three OSes for Rust, Linux only for frontend

**Chosen:** GitHub Actions with two jobs.
- **rust**: matrix `{ubuntu-latest, macos-latest, windows-latest}`, runs `cargo fmt --check` then `cargo test` in `src-tauri/`.
- **frontend**: `ubuntu-latest` only, runs `npm ci` then `npm run build`.

**Rationale for matrix:**
- The project's stated cross-platform target is macOS + Windows (README, memory). Linux is not a shipping target but it's the free/fast tier of GH Actions, and running there catches bugs that would otherwise only surface on macOS. Cost is negligible.
- The Windows agent-name-normalization bug (fixed in a previous review pass but "verified via unit tests only — could not verify live on Windows hardware") is exactly the kind of regression a Windows CI run would catch empirically. This is the highest-value part of the matrix.
- Frontend build (`tsc && vite build`) is fully platform-independent — running it on all three OSes is pure cost for no signal. One OS is enough.

**Rationale for `cargo fmt --check` inclusion:**
- Two lines of workflow to prevent trailing-whitespace-style debates forever. Standard Rust practice.
- Deliberately *not* including `cargo clippy` — see Non-Goals.

**Alternatives considered:**
- **Rust on Linux only**: rejected — misses the class of bugs the Windows fix above was specifically written to prevent regressions of.
- **Matrix for frontend too**: rejected — pure cost, no signal on a platform-independent build.
- **`cargo build` before `cargo test`**: rejected — `cargo test` compiles what it needs; a separate build step is redundant on a small crate.
- **Nightly Rust or MSRV pinning**: rejected — project uses stable Rust; no MSRV policy declared yet, don't invent one in this change.

### D3: License declarations kept in sync in three places

**Chosen:** Declare MIT in three places:
- `LICENSE` file at repo root — the authoritative text.
- `package.json` — `"license": "MIT"` (SPDX identifier).
- `src-tauri/Cargo.toml` — `license = "MIT"` (SPDX identifier under `[package]`).

**Rationale:** npm and cargo both consume the license field independently; a mismatch is worse than silence. All three use the same SPDX identifier (`MIT`) so drift is easy to grep for. There's no way to have a single source of truth across the two ecosystems without pre-build codegen, which is a much bigger hammer than this project needs.

**Alternatives considered:**
- **Only the `LICENSE` file, leave manifests unset**: rejected — npm and cargo emit warnings, and downstream tools that read manifest metadata (SBOM generators, npm registry UI) won't know what to say.

### D4: HandoffDocs/ privacy policy — defer, do not decide here

**Chosen:** Do not modify `.gitignore` for `HandoffDocs/`, do not stage it in the initial commit either. Ask the user before doing either.

**Rationale:**
- The `multi-agent-handoff` skill body explicitly says: `Never assume HandoffDocs/ is private. Choose private/local or shared/team policy first.`
- The user has never made this choice for LoganTerminal.
- Both options are defensible:
  - **Private/local** (`.git/info/exclude`): keeps agent coordination notes out of the public repo, consistent with the fact that `Logan的文档/` is already gitignored.
  - **Shared/team** (commit them): makes agent history a public artifact, useful for a solo maintainer who wants a paper trail but shows internal-ish notes to any GitHub visitor.
- The safe default that doesn't foreclose either option: initial commit skips `HandoffDocs/` (untracked and unignored), and the tasks file will surface this as an explicit prompt at the end.

**Alternatives considered:**
- **Gitignore `HandoffDocs/` unilaterally**: rejected — bakes the "private" choice into the initial commit; user hasn't asked.
- **Commit `HandoffDocs/` unilaterally**: rejected — bakes the "shared" choice; user hasn't asked, and the current `HandoffDocs/handoffs/openspec-workflow-init.md` mentions Logan's local paths, which is fine but a decision-worthy detail.

### D5: `openspec/` directory — commit it in the initial commit

**Chosen:** Include `openspec/` (including this change directory) in the initial commit.

**Rationale:** OpenSpec is intended to be part of the project's source-controlled history — the whole point is that specs and changes live alongside code and are reviewable. This is the project's stated workflow now.

### D6: Initial commit shape

**Chosen:** One initial commit that stages everything except `HandoffDocs/` and files already covered by `.gitignore`. Message: `chore: initial commit`.

**Rationale:** A single initial commit is the standard shape. Trying to carve the current tree into a "logical history" retroactively is make-work — the value of git starts from the *next* commit onward. The one deviation from "stage everything" is `HandoffDocs/`, per D4.

## Risks / Trade-offs

- **CI-locally-unrunnable-until-pushed**: The workflow file will sit dormant until the repo lands on GitHub. If the user delays pushing, the "CI-enforced" guarantee is aspirational. → Mitigation: acceptable; the workflow file is still lossless documentation of intent, and running `cargo test && npm run build` locally covers the same ground until push.
- **Windows CI runners are slow (2–4 min just to boot)**: Every push waits on the Windows job. → Mitigation: accepted cost; Windows regressions like the earlier `.exe`-suffix agent-name bug are exactly what this catches, and there's no way to catch them without running on Windows.
- **`cargo fmt --check` will fail on any hand-formatted-differently line**: This is the point, but it can surprise contributors. → Mitigation: acceptable; standard Rust practice, well-understood.
- **MIT locks in a permissive posture**: If the project later becomes commercially valuable, going stricter is legally awkward. → Mitigation: accepted; user's expressed intent is open-source under a permissive license, and this is the same posture as most tools in this niche.
- **License field drift across `LICENSE`, `package.json`, `Cargo.toml`**: An edit to one might not propagate. → Mitigation: the three-place list in the tasks makes drift visible during review; a follow-up "sync check" script is out of scope.
- **First-time GitHub Actions consumption**: Free tier for public repos; effectively unlimited for this project's scale. → No mitigation needed.

## Migration Plan

Not applicable — no data migration, no API change, no existing users to migrate. The single "cutover" is `git init` + initial commit; before that moment nothing is version-controlled, after it everything is. Rollback strategy is `rm -rf .git`, which is trivial and destroys nothing else.

## Open Questions

- **HandoffDocs/ privacy choice**: Deferred to end-of-implementation user prompt (see D4). Not a blocker for anything else in this change — the initial commit intentionally leaves `HandoffDocs/` untracked-and-unignored, both directions remain open.
- **Repo default branch name**: `git init` defaults to `main` on modern git (≥ 2.28 with `init.defaultBranch` set, which is the norm on macOS Command Line Tools). If the local default is `master`, the tasks include an explicit `git branch -m main`. No user input needed.
