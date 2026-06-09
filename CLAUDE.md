# CLAUDE.md

Read **[`AGENTS.md`](AGENTS.md)** first — it's the canonical contract for working in this
repo (what this is, hard rules, code style, how to add detectors/skills). This file only
adds the Claude-Code-specific notes that aren't in there.

## This is the toolkit, not a consumer Overwolf app

Overwolf's [AI coding assistants guide](https://dev.overwolf.com/ow-native/guides/dev-tools/ai-coding-assistants-config/)
gives a `CLAUDE.md` template for *consumer* **Overwolf Native** apps — it declares a
"Native project" and tells the assistant to grep `node_modules/@overwolf/**/*.d.ts` first.

**That template does not apply here.** This repo is the inverse: a **zero-dependency,
zero-build** Node CLI (`engine/`) plus a markdown knowledge base (`references/`). There is
**no `@overwolf` SDK** to grep, and adding npm dependencies is forbidden (see `AGENTS.md`).
Don't paste that template in.

## Looking up Overwolf platform facts

Follow the lookup order in **[`AGENTS.md`](AGENTS.md#looking-up-overwolf-docs)** —
`references/overwolf-platform-primer.md` first, then the official Overwolf docs MCP — and
don't guess platform behavior.

Claude-Code-specific: the root **`.mcp.json`** registers that MCP (`ow-docs-mcp`); if its
`mcp__ow-docs-mcp__algolia_search_index_overwolf` tool isn't listed, reload Claude Code.
