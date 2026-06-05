# overwolf-app-toolkit

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
# human-readable report
node engine/cli.mjs "C:\path\to\SupportLogs.zip" --report

# structured JSON (the integration point for any tool/agent)
node engine/cli.mjs "C:\path\to\SupportLogs.zip" --json

# mask PII before sharing anything (tickets, chat, issues)
node engine/cli.mjs "C:\path\to\SupportLogs.zip" --report --redact

# add your app's own detectors (kept in YOUR repo, not here)
node engine/cli.mjs "<bundle>" --json --rules ./my-app-rules.mjs
```

It accepts a `.zip` (extracted via your OS's unzip) or an already-extracted folder.
Once published to npm you can also run it without cloning: `npx overwolf-log-doctor …`.

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

Full contract, JSON schema, and a paste-in agent instruction snippet:
**[USING-WITH-AGENTS.md](USING-WITH-AGENTS.md)**.

### Claude Code (optional one-step plugin)

```text
/plugin marketplace add Counterwatch/overwolf-app-toolkit
/plugin install overwolf-app-toolkit@overwolf-app-toolkit
```

This adds two auto-triggering skills — `overwolf-log-doctor` (say "troubleshoot this
Overwolf log zip: <path>") and `overwolf-app-primer` (say "explain how Overwolf apps
work"). They wrap the exact same engine and knowledge base described above.

### Other skill-aware agent CLIs

The `skills/*/SKILL.md` files use the increasingly cross-tool skill format, so
skill-aware CLIs (e.g. GitHub Copilot CLI, Gemini CLI) may discover them too. Anything
that can't use skills can still call the CLI directly (see above).

---

## What it reports

The JSON (`overwolf-log-doctor/diagnosis@1`) contains: `bundle` (layout + primary app),
`environment` (app/Overwolf version, OS, GPU, timezone), `sessions` (per-window
timelines), `signals` (ranked findings with evidence), `correlations` (e.g. "activity
recorded after the last successful sync"), and a merged `timeline`. Detectors are
**generic** keyword/pattern matchers — they tell you *where to look*, not a guaranteed
verdict. See [USING-WITH-AGENTS.md](USING-WITH-AGENTS.md) for the field-by-field schema.

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
                      extending-detectors
skills/             Claude Code skills (optional layer over engine + references)
.claude-plugin/     plugin.json + marketplace.json (Claude Code one-step install)
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
