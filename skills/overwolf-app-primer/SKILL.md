---
name: overwolf-app-primer
description: Use when an AI needs to understand how Overwolf apps work before building, reviewing, debugging, or reasoning about one — windows (background/in-game/desktop), the manifest, the Game Events Provider (GEP), app lifecycle and IPC, storage/auth/sync, and the logging model. Loads a distilled, offline Overwolf platform primer instead of re-fetching the full docs.
---

# Overwolf App Primer

Load a concise mental model of the Overwolf app platform into context. This is a fast,
offline first layer over the official docs — enough to reason correctly about app
structure and behavior without round-tripping the full documentation each time.

## Use this when

- You're about to build, review, or modify an Overwolf app and need the platform model.
- You're debugging app behavior (overlays, game events, windows, sync) and need to know
  how the pieces fit.
- Another skill (e.g. `overwolf-log-doctor`) needs grounding in what a window or the GEP
  is.

## The primer

@${CLAUDE_PLUGIN_ROOT}/references/overwolf-platform-primer.md

## Going deeper

The primer is self-contained for the basics and links to the authoritative page in
each section. When you need specifics it doesn't cover (exact API signatures, the full
manifest field reference, per-game event schemas), go to the official docs at
**https://dev.overwolf.com** — that's all you need.

Optionally, *if* the Context7 MCP server happens to be available in this environment,
you can query the library `/websites/dev_overwolf` for the same docs — a convenience,
not a requirement. Treat the live docs as the source of truth if they ever disagree
with the primer.
