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

> **Last synced: 2026-06-05** against dev.overwolf.com (Native apps).
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

The manifest is the app's root config. Key parts:

- **`meta`** — `name`, `version`, `minimum-overwolf-version`, `author`, `icon`,
  `description`.
- **`permissions`** — an array gating most `overwolf.*` APIs, e.g.
  `["GameInfo", "GameControl", "Hotkeys", "Streaming", "FileSystem", "Extensions"]`.
- **`data.windows`** — the app's windows, keyed by name (see §3).
- **`data.start_window`** — which window opens first.
- **`data.launch_events`** — auto-launch triggers, e.g. on game launch (see §4).
- **`data.game_targeting`** — which games the app may draw in-game overlays for, by
  numeric **game id**: `{ "type": "dedicated", "game_ids": [5426, 7764] }`.
- **`data.plugins`** — bundled native plugins.

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
  "game_targeting": { "type": "dedicated", "game_ids": [5426, 7764] }
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

Apps can launch manually or automatically. **`launch_events`** trigger the app on
events such as a targeted game launching (`game_ids`, `wait_for_stable_framerate`,
`start_minimized`). The background/controller window typically comes up first
(`start_window` + `is_background_page`), starts services, then opens or messages the
in-game/desktop windows as needed.

Docs: https://dev.overwolf.com/ow-native/guides/general-tech/using-game-events-in-your-app

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

Games are identified by a numeric **game id** (the same ids used in `game_targeting`
and `launch_events`). In logs you'll see game detection, then required-feature
registration (§7).

Docs: https://dev.overwolf.com/ow-native/reference/games/games

## 7. Game Events Provider (GEP)

The **Game Events Provider** supplies apps with **Live Game Data** for supported
games, in two flavors:

- **Game Info** — current state (map, mode, match info, player/quests). Delivered via
  **`overwolf.games.events.onInfoUpdates2`**.
- **Game Events** — real-time moment-to-moment events (kill, death, match start/end).
  Delivered via **`overwolf.games.events.onNewEvents`**. Events are **not stored** —
  you must have a listener attached when they fire.

To receive anything you must opt in to the features you need with
**`overwolf.games.events.setRequiredFeatures(features, callback)`** (e.g.
`["gep_internal", "game_info", "match_info"]`; supported features differ per game).
Handle **`overwolf.games.events.onError`** and surface GEP problems to users.

Because GEP is per-game and depends on the live game + Overwolf's provider, it's a
common source of "missing in-game data" issues — hence the doctor's `gep-health`
signal.

Docs: https://dev.overwolf.com/ow-native/live-game-data-gep/live-game-data-gep-intro
· https://dev.overwolf.com/ow-native/reference/games/events

## 8. Permissions

Most `overwolf.*` APIs require the relevant entry in the manifest `permissions` array
(e.g. `GameInfo` for game data, `GameControl`, `Hotkeys`, `FileSystem`, `Streaming`,
`Extensions`). A missing permission is a common reason an API silently does nothing.

Docs: https://dev.overwolf.com/ow-native/reference/manifest/manifest-json

## 9. Storage, auth & sync (app-provided)

Overwolf doesn't dictate how an app persists data. Apps commonly keep **local state**
(IndexedDB/local storage/files via `overwolf.io`) and, if they have accounts, run
their **own auth and backend sync** to a server. None of this is part of Overwolf
itself — so sync/auth bugs live in the app's code and backend, and show up in the
**app's** window logs (background window), not the Overwolf platform traces. This is
why the doctor's `sync-signal`/`auth-signal` detectors are generic keyword matchers
rather than platform APIs.

## 10. Logging & the support-log bundle

Each window's console/log output is persisted by Overwolf into per-window log files.
The user's **"send logs"** action zips these together with Overwolf platform traces
(`Trace_*.log`), crash telemetry (`Crash.json`, `ExceptionDetails.txt`), the updater
log, and per-process crash dumps. That zip is exactly what `overwolf-log-doctor`
parses. For the full file-by-file layout and the log-line format, see
`references/bundle-anatomy.md`.
