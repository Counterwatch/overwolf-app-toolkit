# Overwolf platform primer (for AIs)

A distilled mental model of how Overwolf apps work, so you can reason about building,
reviewing, and debugging one without re-reading the full docs. **This primer is
self-contained** — the facts you need are inline here. When you want more depth (exact
API signatures, the full manifest field reference, per-game event schemas), read the
authoritative page linked at the end of each section on **https://dev.overwolf.com**.
That's all you need — no special tooling required, though the optional docs MCP below
makes fetching current docs more convenient.

> _Optional:_ if Overwolf's official docs MCP server (`ow-docs-mcp`) is available in your
> environment, search the live docs with the
> `mcp__ow-docs-mcp__algolia_search_index_overwolf` tool (always faceted
> `facet_docusaurus_tag: docs-ow-native-current`) — a convenience for fetching current
> docs, not a requirement.

> **Last synced: 2026-08-04** against dev.overwolf.com (Native apps).
> **How to refresh:** re-read the official docs (https://dev.overwolf.com — or, if you
> have it, the official `ow-docs-mcp` docs MCP described above) for the topics below,
> update the facts + links, and bump this date. See `CONTRIBUTING.md`.

If this primer and the live docs ever disagree, the live docs win.

---

## 1. What an Overwolf app is

An Overwolf app is a desktop app for gamers built with ordinary **HTML, CSS, and
JavaScript**, running inside the Overwolf client's **Chromium/CEF** runtime (so each
window is essentially a web page). Apps can call `overwolf.*` JavaScript APIs to reach
desktop/game capabilities, and may bundle **C# plugins** (`.dll`) for native work.
Apps are distributed and monetized via the Overwolf Appstore.

An app typically surfaces in three places: **in-game overlays**, **standalone desktop
windows**, and **second-screen** views.

Docs: https://dev.overwolf.com/ow-native/getting-started/overview

## 2. The manifest (`manifest.json`)

The manifest is the app's root config — mandatory, and in the app's root folder. Key
parts:

- **`meta`** — `name`, `version`, `minimum-overwolf-version`, `author`, `icon`,
  `description`. `name` + `author` generate the app's permanent UID, which cannot change
  after publishing. `minimum-gep-version` pins the Game Events Provider version for apps
  that use live game data (§7).
- **`permissions`** — an array declaring which `overwolf.*` APIs the app uses, e.g.
  `["GameInfo", "GameControl", "Hotkeys", "Streaming", "FileSystem", "Extensions"]`
  (see §8).
- **`data.windows`** — the app's windows, keyed by name (see §3).
- **`data.start_window`** — which window opens first.
- **`data.launch_events`** — auto-launch triggers, e.g. on game launch (see §4).
- **`data.game_targeting`** — which games the app may draw in-game **overlays** for, by
  numeric **game id**: `{ "type": "dedicated", "game_ids": [5426, 7764] }` (`type` is
  `"all"`, `"dedicated"`, or `"none"`).
- **`data.game_events`** — a *separate* array of game ids the app wants **real-time game
  events** for (§7). Overlay targeting alone delivers no events, and there is no
  wildcard — every game must be listed explicitly. A game missing here is a common cause
  of "the app shows no live data".
- **`data.extra-objects`** — bundled native plugin DLLs (`{ "file": …, "class": … }`),
  reached at runtime via `overwolf.extensions.current.getExtraObject()`.

```json
"data": {
  "start_window": "index",
  "windows": {
    "index": { "file": "index.html", "is_background_page": true },
    "in_game": { "file": "in_game.html", "in_game_only": true, "transparent": true },
    "desktop": { "file": "desktop.html", "desktop_only": true, "resizable": true }
  },
  "launch_events": [
    { "event": "GameLaunch", "event_data": { "game_ids": [5426, 7764] }, "start_minimized": true }
  ],
  "game_targeting": { "type": "dedicated", "game_ids": [5426, 7764] },
  "game_events": [5426, 7764]
}
```

Docs: https://dev.overwolf.com/ow-native/reference/manifest/manifest-json

## 3. Windows (and how they map to logs)

Every UI surface is a **window** declared under `data.windows`. Each window is its own
HTML page/CEF process. Common roles:

- **Background / controller window** — a hidden window flagged
  `"is_background_page": true`. It has no UI and acts as the app's always-on
  controller: it auto-launches, owns long-lived services, holds shared state, and
  coordinates the other windows. **This is where most logic and the most diagnostic
  logging lives.**
- **In-game (overlay) window** — `"in_game_only": true`, usually `transparent`; shown
  as an overlay on top of the game.
- **Desktop / launcher window** — `"desktop_only": true`; a normal standalone window
  for setup, history, settings, etc.

In a support-log bundle, each window logs to its own file: `background.html.log`,
`in_game.html.log`, `desktop.html.log` / `launcher.html.log`, `auth.html.log`, …
(rotated as `*.1.log`, `*.2.log`). See
`references/bundle-anatomy.md`.

Docs: https://dev.overwolf.com/ow-native/guides/dev-tools/windows/using-overwolf-windows
· https://dev.overwolf.com/ow-native/guides/dev-tools/windows/general-tips-for-using-windows

## 4. App lifecycle & launch

Apps can launch manually or automatically. **`launch_events`** takes one of three fixed
events — `"GameLaunch"` (specific `game_ids`), `"AllGamesLaunch"`, or
`"LaunchWithOverwolf"` (whenever the Overwolf client starts) — with modifiers like
`wait_for_stable_framerate`, `start_minimized`, and `tracked` (fire on game-id detection
even without injection). An app launching with `LaunchWithOverwolf` must not show a
window until a game starts or the user opts in.

The background/controller window typically comes up first (`start_window` +
`is_background_page`), starts services, then opens or messages the in-game/desktop
windows as needed. `data.auto_relaunch_on_crash` restarts the app after a crash (up to 7
consecutive crashes) — worth knowing when a log shows repeated startups.

Docs: https://dev.overwolf.com/ow-native/reference/manifest/manifest-json
· https://dev.overwolf.com/ow-native/guides/general-tech/using-game-events-in-your-app

## 5. Communicating between windows (IPC)

Windows are separate JS contexts, so they need IPC:

- **Shared background object (recommended):** `overwolf.windows.getMainWindow()`
  returns the main/background window's actual HTML `Window` object — its JS functions
  and a shared global "communication bus" are directly callable from other windows.
  More reliable than enumerating open windows.
- **Direct messages:** `overwolf.windows.sendMessage()` to a specific window, received
  via the `overwolf.windows.onMessageReceived` event. Best for small payloads.

Docs: https://dev.overwolf.com/ow-native/guides/dev-tools/windows/communicating-between-windows

## 6. Game detection

- `overwolf.games.getRunningGameInfo()` — info about the currently running game.
- `overwolf.games.onGameInfoUpdated` — fires when game state changes (launch, focus,
  resolution, termination).

Games are identified by a numeric **game id** (the same ids used in `game_targeting`,
`game_events`, and `launch_events`). In logs you'll see game detection, then
required-feature registration (§7). `overwolf.games` needs no feature registration —
it's the API to reach for when you only want process name, focus, and running state.

Docs: https://dev.overwolf.com/ow-native/reference/games/ow-games
· Game id list: https://dev.overwolf.com/ow-native/guides/dev-tools/games-ids

## 7. Game Events Provider (GEP)

The **Game Events Provider** supplies apps with **Live Game Data** for supported
games, in two flavors:

- **Game Info** — persistent state (map, mode, match info, player/quests). Delivered via
  **`overwolf.games.events.onInfoUpdates2`**, and stored in a dictionary you can query
  any time with **`overwolf.games.events.getInfo()`**. Info updates fire only when a
  value *changes*, so providers deliberately park a field at `null` between matches to
  guarantee the next real value triggers an update — a value that looks "stuck" may
  simply not have changed.
- **Game Events** — real-time moment-to-moment events (kill, death, match start/end).
  Delivered via **`overwolf.games.events.onNewEvents`**. Events are **not stored** —
  you must have a listener attached when they fire.

Both are grouped into **features** (a feature such as `match` bundles the related events
and info items); you subscribe per feature, and the supported set differs per game.
GEP listens for nothing by default. The documented order is:

1. List the game id in the manifest's **`data.game_events`** array (§2). Without it the
   provider delivers nothing for that game, no matter what the app subscribes to.
2. Attach the `onNewEvents` / `onInfoUpdates2` listeners.
3. Call **`overwolf.games.events.setRequiredFeatures(features, callback)`** (e.g.
   `["gep_internal", "game_info", "match_info"]`) — **from the background/controller
   window only**, and as soon after game launch as possible: the longer the gap, the
   greater the chance of missing events and unreliable data, especially when the app
   starts mid-session. The call **may fail even when the game is already running and must
   be retried** until `result.success === true`, then confirm `result.supportedFeatures`
   is non-empty. See §11 for the failure strings this produces in logs.
4. Call `getInfo()` to pick up state that changed before the listeners existed.

Handle **`overwolf.games.events.onError`** and surface GEP problems to users. Features
do go down — a game update, a studio request, or a data-reliability problem can disable
them — so Overwolf publishes **event status endpoints** that let an app tell "the
provider is down" from "our code is broken":
`https://game-events-status.overwolf.com/gamestatus_prod.json` (every game) and
`https://game-events-status.overwolf.com/<game-id>_prod.json` (one game, per feature).
State is `0` unsupported, `1` green, `2` yellow (partial), `3` red (unavailable), with
roughly 10 minutes of lag behind reality.

> Overwolf explicitly warns **not to log GEP data to log files.** A well-behaved app's
> logs should show registration and error lines around GEP, not event payloads — so
> don't expect a support bundle to contain the events themselves.

Because GEP is per-game and depends on the live game + Overwolf's provider, it's a
common source of "missing in-game data" issues — hence the doctor's `gep-health`
signal.

Docs: https://dev.overwolf.com/ow-native/live-game-data-gep/live-game-data-gep-intro
· https://dev.overwolf.com/ow-native/reference/games/events
· https://dev.overwolf.com/ow-native/live-game-data-gep/verifying-events-for-your-app

## 8. Permissions

Most `overwolf.*` APIs have a matching entry in the manifest `permissions` array (e.g.
`GameInfo` for game data, `GameControl`, `Hotkeys`, `FileSystem`, `Streaming`,
`Extensions`, `Web`, `Tray`, `Subscription`) — declare what the app uses; the client
prompts the user for the sensitive ones and the Appstore reviews them. Note the docs
call out **`FileSystem`** (for `overwolf.io`) as the *only enforced* permission, so a
missing entry is usually **not** why an API silently does nothing. Look instead for a
missing manifest field (`game_events`, §7), an unhandled error callback, or a permission
the user declined. `Logging` (`overwolf.log`) is deprecated.

Docs: https://dev.overwolf.com/ow-native/reference/manifest/manifest-json

## 9. Storage, auth & sync (app-provided)

Overwolf doesn't dictate how an app persists data. Apps commonly keep **local state**
(IndexedDB/local storage/files via `overwolf.io`) and, if they have accounts, run
their **own auth and backend sync** to a server. None of this is part of Overwolf
itself — so sync/auth bugs live in the app's code and backend, and show up in the
**app's** window logs (background window), not the Overwolf platform traces. This is
why the doctor's `sync-signal`/`auth-signal` detectors are generic keyword matchers
rather than platform APIs.

Docs (`overwolf.io`, the one platform API here — local file IO; auth/sync are
app-provided): https://dev.overwolf.com/ow-native/reference/io/ow-io

## 10. Logging & the support-log bundle

Each window's console/log output is persisted by Overwolf into per-window log files.
The user's **"send logs"** action zips these together with Overwolf platform traces
(`Trace_*.log`), crash telemetry (`Crash.json`, `ExceptionDetails.txt`), the updater
log, and per-process crash dumps. That zip is exactly what `overwolf-log-doctor`
parses. For the full file-by-file layout and the log-line format, see
`references/bundle-anatomy.md`.

Three manifest knobs change what actually reaches the bundle, which is worth checking
before concluding that something is "missing" from a log: top-level
`max_rotation_log_files` (10–40, default 10) sets how much rotated history is kept;
`data.disable_log_limit` lifts the 1000-line log limit (only with Overwolf's approval);
and `data.logging.allowed_domains` filters console output from external domains and
iframes (`content.overwolf.com` and `google-analytics.com` are always blocked unless
`disable_blocking` is set). Absent third-party lines may be filtered, not missing.

Docs: https://dev.overwolf.com/ow-native/reference/manifest/manifest-json

## 11. Hard-won gotchas (field-verified)

Behaviors the official docs do not spell out (or describe misleadingly), verified
empirically by a production app team. Unlike the sections above these are not
restatements of the docs; each is dated, and the upstream issue is linked where one
exists. If a future client/SDK release fixes one, update or remove it.

- **Overlay click-through is runtime-only for `windows2`-created windows** (verified
  2026-06, Overwolf-confirmed). For an OSR overlay created via `overwolf.windows2.create`
  (which the official `@overwolf/odk-ts` SDK uses), the ONLY way to make the window
  click-through is the runtime call
  `overwolf.windows.setWindowStyle(windowId, 'InputPassThrough', cb)`. The manifest
  window fields (`clickthrough`, `style`) and the create-time options
  (`clickThrough`, `inputPassThrough`) are all no-ops on that path. Two extra traps:
  the style call is silently dropped if the window is still hidden or unsized, so apply
  it after the window is shown and positioned; and during gameplay the cursor is hidden,
  so click-through is only testable in cursor-visible states (hero select, menus).
  Upstream: https://github.com/overwolf/odk-ts-monorepo/issues/5 (fix announced for a
  future client + odk-ts release).

- **The v1 and v2 window APIs treat the manifest differently** (verified 2026-06,
  Overwolf-confirmed: "when using odk-ts, the manifest is not relevant"). The classic
  `overwolf.windows.obtainDeclaredWindow(name, overrides)` flow uses the manifest's
  window declaration as the baseline and applies overrides. `overwolf.windows2.create`
  does NOT consult the manifest at all: you pass the entire window definition as
  options, and manifest-declared properties for that window are ignored. If your app
  reads window config from the manifest under windows2/odk-ts, that is your own code
  doing it, not the platform. Mixed usage works: v1 calls like `setWindowStyle`
  operate fine on a v2-created window.

- **What `setRequiredFeatures` failure actually looks like after game launch** (verified
  across two games, ongoing). As of the 2026-08 sync the docs *do* now state that this
  call may fail while the game is running and must be retried (§7) — but not the
  specifics. The Game Events Provider attaches asynchronously, so early calls fail with
  transient errors such as "Provider is not ready", "Provider did not set features yet."
  or "Not in a game.". Treat those strings as expected startup noise rather than
  failures; production apps commonly retry every second for minutes (Overwolf's own
  sample retries every 3s for a bounded number of attempts). Only a persistent failure
  after the game is clearly running means the feature genuinely is not supported for that
  game/version. Budget for this in UX: in-game data can legitimately be absent for the
  first seconds of a session.
