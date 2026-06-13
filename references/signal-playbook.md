# Signal playbook

How to interpret each signal the parser emits. Signals are **generic** — they flag
*where to look*, not a definitive diagnosis. Always read the surrounding `timeline`
and quote a (masked) example line as evidence. Severity shown is the default; a signal
is lifted to `error`/`warn` if its evidence lines are at that level.

> Effective severity = max(detector default, highest level among its evidence lines).

## Correlations (read these first)

These combine multiple signals and are usually the headline.

- **`activity-after-sync`** — game/app activity was logged *after* the last successful
  sync. Strong candidate when a user says "my latest data didn't save/sync". Check
  whether a sync ran after the activity, and whether it errored or pushed 0 records.
- **`synced-but-zero-pushed`** — the app reported a "complete / fully synced" state but
  the last sync pushed **0 records** despite activity. Two common explanations:
  (a) there was genuinely nothing new (already uploaded earlier), or (b) new data was
  generated but never entered the sync set (a capture/queueing bug). Disambiguate by
  finding where the user's new data *should* have been written locally before sync.

## Per-signal guide

- **`sync-signal`** — data sync / replication activity. Inspect `data`: `lastPushed`
  (records in the last result), `sawComplete`, `lastCompleteTs`, `lastPushedTs`. A UI
  that shows "Synced" maps to a `sawComplete`/complete line — but that does **not**
  guarantee the user's latest data reached the server (see correlations). Look for the
  last push count > 0 vs. = 0, and whether sync ran after the relevant activity.
- **`auth-signal`** — login/session activity. Confirm the user actually reached a
  signed-in state, and that the session persisted across sessions (background log of a
  later session should already be authenticated). `401/403`/`unauthorized` here often
  explains downstream sync/network failures.
- **`gep-health`** — Game Events Provider trouble. The app may not be receiving live
  game events (kills, match info, roster). If the complaint is about missing in-game
  data or stats, this is likely central. Brief warnings around startup can be benign;
  sustained ones are not. See the primer's GEP section.
- **`network-signal`** — connectivity errors (timeouts, refused/reset connections,
  `net::ERR_*`, websocket drops, 4xx/5xx). Frequently the root cause behind sync/auth
  failures. Correlate timestamps with sync/auth signals.
- **`app-exception`** / **`error-line`** — errors in the app's own logs. `app-exception`
  is the stricter one (uncaught/typed errors, stack traces). A burst right before the
  user's problem time is a strong lead.
- **`updater-issue`** — Overwolf updater failures. Relevant if the user is "stuck on an
  old version" or features are missing that shipped in a newer release.
- **`permissions-csp`** — Content-Security-Policy / permissions-policy violations.
  Usually benign (blocked ad frames, autoplay), but can break a feature if the blocked
  resource is one the app needs.
- **`game-detection`** — game started/stopped/detected and required-feature
  registration. Mostly context: confirms whether the game was running and events were
  requested during the window in question.
- **`warning-line`** — catch-all warnings not matched by a more specific signal. Skim
  for anything relevant to the complaint.
- **`crash-report`** — a captured crash/exception. **Important:** if `data.isLogUpload`
  is true, this is the "send logs" telemetry, **not** an app crash — don't report it as
  one. Otherwise, pair it with `ExceptionDetails.txt` for the stack.
- **`process-crash`** fires when the Overwolf client recorded a hard process death
  (`App crashed - <app> (reason: <Reason>)` in a `Trace_*.log`), the platform's
  authoritative crash record. `data.byApp` groups crashes by app and reason; confirm the
  crashed app is the developer's, not a third-party app sharing the bundle. When this is
  absent next to a marker-based "unclean shutdown", the termination was probably benign
  (PC shutdown, Overwolf-client-update restart, task-kill), not a crash.
- **`renderer-crash`** means a CEF sub-process (renderer/GPU) died, read from an
  `OverwolfBrowserError_<pid>.log`. `data.apps` is the crashed app/window (from `--owapp`)
  and `data.exceptions` is the native fault (e.g. `SEHException (0x80004005)` in libcef).
  It is the native cause behind a `process-crash`; a crash with no app JS frame is a
  platform/CEF problem to escalate to Overwolf, not an app bug.

## Turning signals into a diagnosis

1. Start from the user's complaint and the `correlations`.
2. Pull the 2–3 signals most related to it; read their evidence and the timeline
   around those timestamps.
3. State the **most likely cause** and your **confidence**. If the logs are consistent
   with "working as intended" (e.g. nothing new to sync), say that plainly.
4. Recommend next steps: what the developer should instrument/check, and what to tell
   the user. If the answer isn't in the logs, say what additional log line or repro
   would resolve it — that's a candidate for a new detector or an app-specific rule.

> **Is it widespread?** A single bundle only tells you about one user. If a finding looks
> systemic (a crash, an auth/network failure, a sync regression after a version bump),
> check whether it moved app-wide using the companion **`overwolf-console-mcp`** server
> (tools like `get_app_crashes`, `get_user_retention_daily`, `get_daily_active_users`).
> See the toolkit README → "Companion: app-wide analytics".
