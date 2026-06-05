# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo.

## What this is

An **AI-agnostic** toolkit for Overwolf app developers. The portable core is a
zero-dependency parser + CLI under `engine/` and a plain-markdown knowledge base under
`references/` — usable by any agent, script, or human (see `USING-WITH-AGENTS.md`).
On top, `skills/` + `.claude-plugin/` add an optional Claude Code layer that wraps the
same engine and references. Keep that ordering: engine/references are the product;
the Claude layer is a convenience over them.

## Commands

```bash
node --test            # run all unit tests (engine + parser). Requires Node 20+.
node engine/cli.mjs <zip|dir> --report   # run the doctor on a bundle
```

There is **no build step and no dependencies** — keep it that way.

## Hard rules

- **Zero dependencies, zero build.** `engine/` is plain ESM `.mjs` runnable with `node`.
  Do not add npm dependencies or a compile step. (`jsconfig.json` is editor-only.)
- **Privacy.** Never commit a real support-log bundle, its contents, or any excerpt —
  they contain end-user PII. Tests use the synthetic fixture in
  `tests/fixtures/sample-bundle/` only. `*.zip` is gitignored.
- **Generic core, no app names.** Detectors in `engine/detectors.mjs` match only
  public, app-agnostic concepts (industry keywords + documented Overwolf-platform
  terms). App-specific log strings belong in external `--rules` packs, never here.
- **Don't break the schema.** `diagnose()` returns `overwolf-log-doctor/diagnosis@1`.
  Additive changes are fine; if you change its shape, bump the schema string and update
  the skill + tests.

## Code style

- TypeScript-checked JavaScript (`checkJs`): plain `.mjs` with JSDoc types; `strict`.
- ESM only; Node core modules imported as `node:fs`, `node:path`, etc.
- Pure functions where possible; filesystem access is confined to `bundle.mjs`,
  `diagnose.mjs`, and `extract.mjs`.
- Comments explain *why*, not *what*.

## Adding things

- **A generic detector:** append to `DETECTORS` in `engine/detectors.mjs`, add a
  fixture line + assertion in `tests/`. See
  `references/extending-detectors.md` for the contract.
- **A new skill:** add `skills/<name>/SKILL.md` with `name` + a trigger-rich
  `description`; reference shared docs via `${CLAUDE_PLUGIN_ROOT}`.

## Git workflow

Branch from `main`, open a PR, make sure `node --test` passes. Keep commits focused; no
AI attribution in commit messages.
