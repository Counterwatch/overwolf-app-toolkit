# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo.

## What this is

An **AI-agnostic** toolkit for Overwolf app developers. The portable core is a
zero-dependency parser + CLI under `engine/` and a plain-markdown knowledge base under
`references/` — usable by any agent, script, or human (see `USING-WITH-AGENTS.md`).
On top, `skills/` + `hooks/` + `.claude-plugin/` add an optional Claude Code layer that
wraps the same engine and references. Keep that ordering: engine/references are the
product; the Claude layer is a convenience over them.

## Commands

```bash
node --test            # run all unit tests (engine + parser). Requires Node 20+.
node engine/cli.mjs <zip|dir> --report   # run the doctor on a bundle
node scripts/check-version-sync.mjs      # package.json vs plugin/marketplace manifests
node scripts/check-primer-freshness.mjs  # primer's cited docs pages vs committed baseline
```

There is **no build step and no dependencies** — keep it that way (`scripts/` are
maintenance checks, node core modules only).

## Looking up Overwolf docs

This repo *describes* Overwolf platform behavior (the primer, signal playbook,
platform-term detectors) but does **not** import the `@overwolf` SDK — there are no type
definitions to grep, and Overwolf's "Native project" `CLAUDE.md` template does not apply
here. When you need to confirm how the platform works, use this order:

1. **`references/overwolf-platform-primer.md`** — the distilled offline layer.
2. **Overwolf's official docs MCP** for depth or current facts: tool
   `mcp__ow-docs-mcp__algolia_search_index_overwolf`, always faceted
   `facet_docusaurus_tag: docs-ow-native-current`.

A root `.mcp.json` registers the server for Claude Code (reload if it isn't listed). Any
MCP client can use the same endpoint:

```bash
claude mcp add --transport http ow-docs-mcp \
  https://V9EMDT18EK.algolia.net/mcp/1/cuI6UtBzTwKOL6E0Hvp-hw/mcp
```

Don't guess platform behavior; if the primer doesn't cover it and the MCP has no result,
say so. If the primer and the live docs disagree, the live docs win.

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
- **A hook:** add the script under `hooks/` (zero-dep `.mjs`, export the pure logic so
  tests can import it) and register it in `hooks/hooks.json`. Hooks must never block or
  break the user's prompt — fail silent on malformed input. Add a `tests/` suite.

## Git workflow

Branch from `main`, open a PR, make sure `node --test` passes. Keep commits focused; no
AI attribution in commit messages.
