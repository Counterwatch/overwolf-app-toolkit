# overwolf-app-toolkit

[![npm version](https://img.shields.io/npm/v/overwolf-app-toolkit.svg)](https://www.npmjs.com/package/overwolf-app-toolkit)
[![CI](https://github.com/Counterwatch/overwolf-app-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/Counterwatch/overwolf-app-toolkit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Open-source tooling that helps **Overwolf app developers** (and their AI agents) make
sense of user support logs and the Overwolf platform.

**AI-agnostic by default.** The core is a **zero-dependency, zero-build** Node CLI and a
plain-markdown knowledge base — usable by *any* LLM/agent, your own scripts, CI, or a
human at a terminal. [Claude Code](https://claude.com/claude-code) gets an extra
one-step plugin layer on top, but nothing here requires it.

It provides:

- **`overwolf-log-doctor`** — point it at a user's "send logs" `.zip` and get a ranked,
  structured diagnosis (sync, login/auth, game events / GEP, crashes, updates, network).
  Works for **any** Overwolf app.
- **A distilled Overwolf platform primer** — a concise, offline explainer of how
  Overwolf apps work (windows, manifest, GEP, lifecycle, logging) that you can hand to
  any model so it can reason about your app.

---

## Quick start (any environment)

Requires Node 20+. Nothing to install — the engine has **no dependencies**.

```bash
# human-readable report, scoped to YOUR app (recommended — bundles contain several apps)
node engine/cli.mjs "C:\path\to\SupportLogs.zip" --app "YourAppName" --report

# structured JSON (the integration point for any tool/agent)
node engine/cli.mjs "C:\path\to\SupportLogs.zip" --app "YourAppName" --json

# mask PII before sharing anything (tickets, chat, issues)
node engine/cli.mjs "C:\path\to\SupportLogs.zip" --report --redact

# add your app's own detectors (kept in YOUR repo, not here)
node engine/cli.mjs "<bundle>" --json --rules ./my-app-rules.mjs
```

It accepts a `.zip` (extracted via your OS's unzip) or an already-extracted folder.
No clone needed — run it straight from npm with
`npx -p overwolf-app-toolkit overwolf-log-doctor "<path>" --json`.

---

## Integrations

### Any AI agent / LLM (default)

The doctor is just a CLI that emits JSON, and the knowledge is just markdown — so wiring
it into any agent (OpenAI/Codex, Gemini, Cursor, Copilot, LangChain, a custom harness…)
is three steps:

1. Run `overwolf-log-doctor <bundle> --json`.
2. Give the model the JSON plus `references/signal-playbook.md` (and
   `references/overwolf-platform-primer.md` if it needs platform grounding).
3. Ask it to rank findings against the user's complaint and produce a `--redact`-ed
   ticket summary.

Full contract, JSON schema, a paste-in agent instruction snippet, and prompting tips for
Overwolf work: **[USING-WITH-AGENTS.md](USING-WITH-AGENTS.md)**.

### Claude Code (optional one-step plugin)

```text
/plugin marketplace add Counterwatch/overwolf-app-toolkit
/plugin install overwolf-app-toolkit@overwolf-app-toolkit
```

This adds two auto-triggering skills — `overwolf-log-doctor` (say "troubleshoot this
Overwolf log zip: <path>") and `overwolf-app-primer` (say "explain how Overwolf apps
work"). They wrap the exact same engine and knowledge base described above. It also
registers Overwolf's official **`ow-docs-mcp`** docs-search MCP — no credentials,
read-only; you'll approve it on first use, and if you've already added it yourself, your
registration takes precedence.

The plugin also ships a **`UserPromptSubmit` hook** that watches prompts for
bundle-shaped `.zip` paths (`<text>_<YYYY-MM-DD>_<HH-MM-SS>_<version>_<id>.zip`) and
reminds the agent to invoke `overwolf-log-doctor` instead of unzipping by hand. Skill
descriptions are matched probabilistically — when bundles show up as side evidence in a
bigger question ("crashes are up, here are the only bundles we got"), agents tend to
treat them as plain zip files; the hook makes the routing deterministic.

> **Tool naming caveat:** when the docs MCP comes in via this plugin, Claude Code may
> expose its tool under a plugin-prefixed name rather than the plain
> `mcp__ow-docs-mcp__algolia_search_index_overwolf`. If your repo's own agent docs
> reference the tool by name, register the server directly in your repo's `.mcp.json`
> (snippet below) — the direct registration wins over the bundled copy and keeps the
> stable un-prefixed name.

The same marketplace also offers an **opt-in companion**, `overwolf-console`, which
bundles the [`overwolf-console-mcp`](https://github.com/Counterwatch/overwolf-console-mcp)
server for app-wide analytics — see [Companion: app-wide analytics](#companion-app-wide-analytics).

#### Enroll a whole repo (team setup)

The `/plugin` commands above install for one developer. To give **every Claude Code
session in your app's repo** the toolkit automatically (no manual installs), check this
into the repo's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "overwolf-app-toolkit": {
      "source": { "source": "github", "repo": "Counterwatch/overwolf-app-toolkit" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "overwolf-app-toolkit@overwolf-app-toolkit": true,
    "overwolf-console@overwolf-app-toolkit": false
  }
}
```

The marketplace registers when the folder is trusted; plugins marked `true` auto-enable,
and `false` keeps the credentials-gated console companion discoverable but off.
`autoUpdate: true` matters: third-party marketplaces default to manual updates, so
without it every developer stays pinned to the version first installed until they run
`/plugin marketplace update overwolf-app-toolkit` + `/plugin update` themselves. With it,
Claude Code refreshes the marketplace and updates the installed plugins at session
startup. Pair it with a direct registration of the docs MCP in the repo's `.mcp.json`
for a stable tool name:

```json
{
  "mcpServers": {
    "ow-docs-mcp": {
      "type": "http",
      "url": "https://V9EMDT18EK.algolia.net/mcp/1/cuI6UtBzTwKOL6E0Hvp-hw/mcp"
    }
  }
}
```

Finish by pointing your repo's agent instructions (CLAUDE.md / AGENTS.md) at the tools:
Overwolf docs lookups go to `mcp__ow-docs-mcp__algolia_search_index_overwolf` (faceted
`facet_docusaurus_tag: docs-ow-native-current`), and log-bundle triage runs the doctor
with your app name and rule pack (`--app "YourApp" --rules <your-rules.mjs>`).

### Other skill-aware agent CLIs

The `skills/*/SKILL.md` files use the increasingly cross-tool skill format, so
skill-aware CLIs (e.g. GitHub Copilot CLI, Gemini CLI) may discover them too. Anything
that can't use skills can still call the CLI directly (see above).

---

## Companion: app-wide analytics

`overwolf-log-doctor` answers *"is **this one user** broken?"* For the complementary
question — *"is this **widespread**? how's my app doing overall?"* — there's a sibling
project, **[`overwolf-console-mcp`](https://github.com/Counterwatch/overwolf-console-mcp)**:
an MCP server wrapping the Overwolf **Developer Console** stats API (DAU/MAU, retention,
installs, crashes, ads revenue). Natural pairing: log-doctor finds a crash or sync issue
in one bundle → ask the console MCP whether crashes/retention moved for the whole app.

It's a **separate** project (its own repo + npm package, with its own dependencies), so
the toolkit only *references* it — nothing is merged in:

- **Claude Code:** the `overwolf-console` plugin in this same marketplace bundles it,
  shipped **disabled** so it never bothers log-doctor-only users:
  ```text
  /plugin install overwolf-console@overwolf-app-toolkit
  /plugin enable overwolf-console        # prompts for your Overwolf API credentials
  ```
- **Any other MCP client / agent:** add it directly — `npx -y overwolf-console-mcp` with
  `OVERWOLF_EMAIL` + `OVERWOLF_API_KEY` in the env. See its README for setup.

---

## What it reports

A bundle usually contains **several apps** (yours, Overwolf's own helper apps, and
unrelated third-party apps), so the report is **scoped by ownership**: `topErrors` /
`topWarnings` are *your* app's distinct, clustered messages (weighted toward the
background/main window where the logic lives); `platformErrors` are Overwolf's own
errors (which may be the real source); and `otherApps` just counts apps you don't own so
they can be ignored. Plus `environment`, `sessions`, `signals`, `correlations`, and a
`timeline`. Detectors are **generic** keyword/pattern matchers — they tell you *where to
look*, not a guaranteed verdict. See [USING-WITH-AGENTS.md](USING-WITH-AGENTS.md) for the
field-by-field schema.

## Privacy

A support bundle contains a **real end user's data** (email, account id, game handle,
file paths). This tool:

- runs entirely **locally** and never uploads a bundle anywhere;
- offers `--redact` to mask PII for anything you share;
- ships a **synthetic** test fixture only (no real user data is in this repo).

Always eyeball redacted output before pasting it into a ticket.

## Repository layout

```
engine/             zero-dependency parser + CLI — the portable core
references/          knowledge base (markdown, usable by any agent):
                      overwolf-platform-primer, signal-playbook, bundle-anatomy,
                      extending-detectors (+ primer-freshness.json baseline)
skills/             Claude Code skills (optional layer over engine + references)
hooks/              Claude Code hooks: detect bundle paths in prompts → route to the skill
scripts/            maintenance checks (version sync, primer freshness) — node-only
.claude-plugin/     marketplace.json + the toolkit plugin manifest
plugins/console/    opt-in companion plugin: overwolf-console-mcp (analytics) + the
                     overwolf-console-analyst skill
tests/              node:test suites + a synthetic fixture bundle
USING-WITH-AGENTS.md  how to wire the engine into any LLM/agent
```

## Contributing

Three ways to make it better:

1. **Generic detectors** — patterns useful to *any* Overwolf app: add to
   `engine/detectors.mjs` + a test, and open a PR. (No app-specific log strings here.)
2. **App-specific rule packs** — your app's own log strings stay in *your* repo and load
   via `--rules`. See `references/extending-detectors.md`.
3. **Refresh the platform primer** — keep `references/overwolf-platform-primer.md` in
   sync with https://dev.overwolf.com. See `CONTRIBUTING.md`.

Run `node --test` before opening a PR. See `AGENTS.md` for conventions.

## License & credits

MIT. Built and maintained by [Counterwatch](https://counterwatch.gg), an Overwolf app,
and offered to the Overwolf developer community. Not an official Overwolf project.
