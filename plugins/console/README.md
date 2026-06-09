# overwolf-console (opt-in companion plugin)

A thin Claude Code plugin that bundles the **[`overwolf-console-mcp`](https://github.com/Counterwatch/overwolf-console-mcp)**
server — so, once enabled, your assistant can answer app-wide analytics questions from
the Overwolf Developer Console (DAU/MAU, retention, installs, crashes, ads revenue):
*"what was my DAU last week?"*, *"are crashes up since 2.40.0?"*.

It is a **separate, opt-in plugin** from `overwolf-app-toolkit` (the log-doctor + primer
skills) on purpose:

- It ships **disabled** (`defaultEnabled: false`) so installing the toolkit for log
  triage never starts a server you didn't ask for.
- It needs **your Overwolf Console API credentials**, which Claude Code prompts for via
  the plugin's user config when you enable it.

This plugin contains **no code** — it references the published npm package
`overwolf-console-mcp` (run via `npx`) and adds one skill,
**`overwolf-console-analyst`**, which teaches the assistant the stats API's gotchas
before it reports numbers: daily data lags about a day, `days_back` is a fixed enum
(no custom ranges), `monetized_dau` is known-broken (always `0`), filters want
human-readable values, and "is this one user's problem widespread?" pairs the
console tools with `overwolf-log-doctor`. The two projects stay independent.

## Enable it

From the same marketplace as the toolkit:

```text
/plugin marketplace add Counterwatch/overwolf-app-toolkit
/plugin install overwolf-console@overwolf-app-toolkit
/plugin enable overwolf-console
```

You'll be asked for your Overwolf **email** and **API key** (and an optional default app
ID). Get the key from the [Overwolf Developer Console](https://console.overwolf.com) →
**Settings → Profile**. Verify the server with `/mcp`.

## Not using Claude Code?

Add the same server to any MCP client directly — no plugin needed:

```bash
npx -y overwolf-console-mcp
# with OVERWOLF_EMAIL, OVERWOLF_API_KEY (and optional OVERWOLF_DEFAULT_APP_ID) in the env
```

See the [`overwolf-console-mcp` README](https://github.com/Counterwatch/overwolf-console-mcp)
for full setup and the list of analytics tools.
