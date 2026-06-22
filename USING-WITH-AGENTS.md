# Using overwolf-log-doctor with any AI agent

The doctor is **AI-agnostic**: a zero-dependency CLI that emits JSON, plus a markdown
knowledge base. Any LLM or agent framework (OpenAI/Codex, Gemini, Cursor, Copilot,
LangChain, a bespoke harness) can use it without anything Claude-specific. This page is
the integration contract.

## The 3-step recipe

1. **Run the analyzer** on the bundle and capture JSON:
   ```bash
   node engine/cli.mjs "<path-to-zip-or-folder>" --json
   # no clone needed: npx -p overwolf-app-toolkit overwolf-log-doctor "<path>" --json
   ```
2. **Give the model context**: the JSON output, plus
   `references/signal-playbook.md` (how to interpret each signal) and — if it needs
   platform grounding — `references/overwolf-platform-primer.md` and
   `references/bundle-anatomy.md`.
3. **Ask for a diagnosis**: rank the findings against the user's complaint, state the
   most likely cause + confidence, and produce a **redacted** ticket summary (re-run
   with `--redact`, or have the model mask identifiers).

The model does interpretation; the CLI does the deterministic parsing. You never need to
send the model raw log files.

## CLI contract

```
node engine/cli.mjs <path> [--app <name>] [--json | --report] [--redact] [--rules <file>]
```

- **`<path>`** — a `.zip` (extracted via the host's unzip) or an already-extracted
  folder. Required.
- **`--app <name>`** — the developer's app (the `Apps/<name>` folder; case-insensitive,
  substring ok). Scopes the report to that app + Overwolf; other apps in the bundle are
  ignored. If omitted, the largest non-Overwolf app is assumed (`ownedApp.inferred`).
- **`--json`** — write the diagnosis object to **stdout** as JSON. This is the
  integration point.
- **`--report`** — human-readable report to stdout (default if neither flag given).
- **`--redact`** — mask PII (emails, UUIDs, JWT/Bearer/Basic tokens, gamertags, home
  paths, IPs) in the output. Use for anything shareable.
- **`--rules <file>`** — load extra app-specific detectors from an ES module (see
  `references/extending-detectors.md`).
- **Exit code** `0` on success, `1` on error or missing input. Errors and the
  "run with --redact" hint go to **stderr**, so `--json` stdout stays clean.

## Diagnosis JSON schema (`overwolf-log-doctor/diagnosis@1`)

```jsonc
{
  "schema": "overwolf-log-doctor/diagnosis@1",
  "bundle": {
    "valid": true,                      // false if it doesn't look like an Overwolf bundle
    "root": "(extracted)",              // dir path, or "(extracted)" for a zip
    "primaryApp": "ExampleApp",         // the developer's app folder (null if none)
    "apps": [{ "name": "ExampleApp", "system": false, "files": 4, "bytes": 1234 }],
    "fileCount": 8,
    "categories": { "app-log": 4, "platform-trace": 1, "crash": 1, "updater": 1 }
  },
  "ownedApp": {                         // which app the report is scoped to
    "name": "Counterwatch", "requested": "Counterwatch", "inferred": false, "matched": true
  },
  "environment": {                      // any subset; keys omitted when not found
    "appVersion": "2.0.0", "overwolfVersion": "0.300.0.11", "gepVersion": "301.0.2",
    "os": "Windows 11 64-bit", "gpu": "NVIDIA GeForce RTX 3060", "timezone": "UTC+02:00"
  },
  "volume": {                           // raw lines vs. distinct messages — reveals spam; topX is capped, these are not
    "ownedErrors": { "lines": 5432, "distinct": 8 }, "ownedWarnings": { "lines": 60, "distinct": 5 },
    "platformErrors": { "lines": 120, "distinct": 6 }, "platformWarnings": { "lines": 859 }
  },
  "topErrors": [                        // the OWNED app's distinct errors, background/main-window weighted — the headline
    { "count": 412, "level": "ERROR", "sample": "Database has been closed",
      "normalized": "database has been closed", "window": "background",
      "firstTs": 1767265200000, "lastTs": 1767265500000, "file": "Apps/<App>/background.html.log" }
  ],
  "topWarnings": [ /* same shape, owned app's WARN lines */ ],
  "platformErrors": [ /* same shape — Overwolf's OWN errors (traces/updater/system apps); could be the source */ ],
  "otherApps": [                        // third-party apps you don't own — counts only, ignore these
    { "name": "Thunderstore Mod Manager", "errors": 10, "warnings": 7 }
  ],
  "sessions": [
    { "file": "Apps/ExampleApp/background.html.log", "window": "background",
      "sessions": [{ "entries": 11, "start": 1767265200010, "end": 1767265503000 }] }
  ],
  "signals": [                          // ranked high→low severity
    { "id": "sync-signal", "title": "Data sync / replication activity",
      "category": "sync", "severity": "notice", "count": 5,
      "evidence": [{ "file": "...", "ts": 1767265204200, "level": "INFO", "message": "..." }],
      "data": { "lastPushed": 0, "sawComplete": true, "lastCompleteTs": 1767265204200 } }
  ],
  "correlations": [                     // cross-signal conclusions — usually the headline
    { "id": "activity-after-sync", "severity": "warn", "message": "...", "data": { } }
  ],
  "timeline": [                         // chronological notable events (WARN/ERROR + key signals)
    { "ts": 1767265204200, "level": "WARN", "file": "...", "message": "...", "signal": "gep-health" }
  ]
}
```

Notes:
- `severity` ∈ `info | notice | warn | error | critical`. A signal's effective severity
  is lifted to match its highest-level evidence line.
- `ts` is epoch milliseconds (a number) or `null`. Timestamps are the user's local
  wall-clock as written in the logs; treat them as relative within one bundle.
- Built-in `correlations` include `activity-after-sync` and `synced-but-zero-pushed`
  (generic shapes behind "it says synced but my data didn't save").

## Paste-in agent instructions

Drop something like this into your agent's system prompt or tool description:

```text
You can diagnose Overwolf app support-log bundles. To do so:
1. Run:  overwolf-log-doctor "<path-to-zip-or-folder>" --json
   (it extracts zips itself; output is JSON of schema overwolf-log-doctor/diagnosis@1).
2. Interpret the JSON using references/signal-playbook.md. Lead with `correlations`
   and the signals most relevant to the user's complaint; cite a (masked) evidence line.
3. State the most likely cause and your confidence. If the logs look consistent with
   "working as intended", say so.
4. Produce a redacted summary safe for a support ticket — run with --redact and confirm
   no PII (email, account id, game handle, file paths) remains before sharing.
Never upload the bundle anywhere; it contains a real end user's personal data.
```

## Knowledge base (for grounding any model)

All under `references/` — plain markdown, no tooling required:

- `overwolf-platform-primer.md` — what an Overwolf app is and how it works.
- `signal-playbook.md` — each signal's meaning and recommended action.
- `bundle-anatomy.md` — what every file in a bundle is, and the log-line format.
- `extending-detectors.md` — the detector contract + how to add app-specific rules.

For *live* Overwolf docs (current API signatures, the full manifest reference) alongside
this offline primer, Overwolf publishes an official docs MCP server. Any MCP-capable agent
can register it and call its `algolia_search_index_overwolf` tool, always faceting queries
with `facet_docusaurus_tag: docs-ow-native-current`. Naming: a direct registration in
Claude Code surfaces it as `mcp__ow-docs-mcp__algolia_search_index_overwolf`; when it
arrives bundled inside the toolkit plugin instead, the name may carry a plugin prefix.
Prefer the direct registration in any repo whose own docs reference the tool by name:

```bash
claude mcp add --transport http ow-docs-mcp \
  https://V9EMDT18EK.algolia.net/mcp/1/cuI6UtBzTwKOL6E0Hvp-hw/mcp
```

The primer stays the offline first layer; the live docs win on any conflict.

## Prompting your assistant for Overwolf work

Building or debugging the *app itself* (beyond reading logs)? Overwolf's
[AI coding assistants guide](https://dev.overwolf.com/ow-native/guides/dev-tools/ai-coding-assistants-config/)
suggests a few prompt habits that sharpen results:

- Include **"Overwolf"** so the assistant prioritizes Overwolf APIs over generic web ones.
- Specify **"Native"** or **"Electron"** to pin the framework.
- Say **"documentation"** or **"API"** to signal the kind of answer you want.
- Give your **filename / module** for context, and explicitly ask for a **"code example"**
  when you need implementation, not just prose.
- Break complex questions into individual steps.
- For errors, paste the **raw error text** and add **"Fix"**.

## Companion: app-wide analytics

The doctor diagnoses one user's bundle. For *aggregate* questions ("is this crash
widespread? how's retention?") there's a separate project,
**[`overwolf-console-mcp`](https://github.com/Counterwatch/overwolf-console-mcp)** — an
MCP server over the Overwolf Developer Console stats API. Any MCP-capable agent can add
it directly:

```bash
npx -y overwolf-console-mcp     # with OVERWOLF_EMAIL + OVERWOLF_API_KEY in the env
```

A useful agent pattern: when the doctor surfaces a crash/sync/auth signal, cross-check
whether it's app-wide via the console MCP's tools (`get_app_crashes`,
`get_user_retention_daily`, `get_daily_active_users`, …) before concluding.

## Roadmap

An optional MCP-server wrapper for the doctor itself (exposing the diagnosis as a tool
callable by any MCP-capable client) is a natural future addition; it would build on the
same engine. The engine deliberately stays dependency-free, so such a wrapper would live
alongside it rather than inside it. Contributions welcome.
