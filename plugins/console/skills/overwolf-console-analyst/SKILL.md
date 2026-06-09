---
name: overwolf-console-analyst
description: Use when answering questions about an Overwolf app's live audience, usage, or revenue from the Overwolf Developer Console - DAU/MAU, installs/uninstalls, retention, crashes, window usage, ads revenue ("what's my DAU?", "are crashes up since the last release?", "how much did ads make this month?") - or when checking whether a single user's problem is widespread. Wraps the overwolf-console MCP tools and encodes the stats API's gotchas (1-day data lag, fixed time windows, known-broken fields).
---

# Overwolf Console Analyst

Answer app-wide analytics questions using the `overwolf-console` MCP server's tools
(`mcp__overwolf-console__*` when registered directly; plugin-bundled servers may carry a
plugin-prefixed name). The server is read-only: it reports the same numbers as the
Overwolf Developer Console dashboard and can mutate nothing.

## Availability

The server needs personal credentials (Overwolf account email + API key), so it may not
be configured in every session. If the tools are absent, the data is NOT unavailable;
tell the developer the server needs setup (see the plugin README) instead of reporting
the metric as unreachable.

## Picking the right tool

- `list_endpoints` returns the authoritative live tool list with each endpoint's
  parameters and defaults. Reach for it when unsure what exists.
- Usage questions: `get_daily_active_users`, `get_monthly_active_users`,
  `get_app_installs`, `get_app_uninstalls`, `get_user_retention_daily` /
  `_weekly` / `_monthly`, `get_app_crashes`, `get_dau_per_country`,
  `get_app_version_by_dau`, window open count/duration tools.
- Revenue questions: `get_daily_ads_revenue_gross_net`,
  `get_month_to_date_revenue_net`, video/display ads metric tools.
- Anything without a typed tool: `query_console_stats` calls any
  `/api/stats/<category>/<slug>` endpoint directly.

## Gotchas (apply before reporting any number)

- **Data lags about one day.** Daily stats are full-day rollups; the current day is
  absent until the feed refreshes the next morning. "DAU today" therefore means
  "yesterday's finalized number" - say so when you report it.
- **`days_back` is a fixed enum**, not a free range: `"Last 30 Days"`,
  `"Last 90 Days"`, `"Last 180 Days"`, `"Last 365 Days"`. There is no single-day or
  custom-range option; pull the smallest window that covers the question and filter
  the rows yourself.
- **`monetized_dau` is known-broken**: it reads `0` on every row of the DAU feed.
  Ignore it and do not report it as a finding.
- **Filter values are human-readable strings**: `country_name` wants capitalized full
  names (`"United States"`) or `"All Countries"`; `app_version` is a version string or
  `"All Versions"`; `window_name` is a manifest window name (e.g. `"desktop"`) or
  `"All Windows"`.
- **`app_id`** defaults to the configured default app; only pass it to query a
  different app.

## Pairing with overwolf-log-doctor

The natural workflow when triaging a user report: `overwolf-log-doctor` answers
"is this one user broken?", this skill answers "is it widespread?". When the doctor
surfaces a crash, sync, or auth signal in a bundle, cross-check the fleet before
concluding - e.g. `get_app_crashes` for a crash signal, `get_user_retention_daily` +
`get_daily_active_users` for anything that would push users away, filtered by
`app_version` if the report names one. One bad bundle plus flat fleet metrics suggests
a local/environmental cause; matching fleet movement suggests a regression.

## Reporting style

State the date range actually returned (not the range asked for), note the one-day lag
whenever "today/now" was requested, and compare against a baseline period rather than
quoting a lone number when the question is "is X up/down?".
