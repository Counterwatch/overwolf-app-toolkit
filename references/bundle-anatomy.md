# Anatomy of an Overwolf support-log bundle

When a user clicks "Send logs" (or an app collects logs), Overwolf produces a `.zip`
whose filename often encodes context, e.g.:

```
<free-text>_<ticketId>_<YYYY-MM-DD>_<HH-MM-SS>_<appVersion>_<shortcode>.zip
```

Inside, the layout is consistent enough that a parser can rely on it. Files fall into
two groups: **Overwolf platform** files at the root, and **per-app** logs under `Apps/`.

## Root — Overwolf platform

| File / pattern | What it is |
|---|---|
| `Trace_<ts>_<pid>.log` | Main Overwolf client trace: client version, OS, GPU, timezone, CEF init, which extensions loaded, game detection. Best source of environment facts. |
| `InstallerTrace_*.log` | Installer/bootstrap trace. |
| `Crash.json` | Structured crash/exception telemetry. **Note:** a `Crash.json` whose `SubSystem`/`Process` is `Logs` is the "send logs" action itself, *not* an app crash. |
| `ExceptionDetails.txt` | Full .NET stack trace for a captured exception. |
| `OverwolfUpdater.log` | The Overwolf updater service (update checks, downloads). |
| `OverwolfPerf.txt` | Per-process CPU/RAM snapshot. |
| `ServiceInstall.Log` | Overwolf service registration. |
| `*.Game.html` | Per-process crash dumps (Overwatch/OverwolfHelper/etc.). |
| `OverwolfBrowserError_<pid>.log` | A CEF sub-process (renderer/GPU) crash log. Its command line identifies the app and window (`--owapp=<App> - <window>`, `--type=renderer`) and it carries the native fault (e.g. an `SEHException 0x80004005` in `libcef.dll`). Its presence confirms a real process crash, unlike an app's own "unclean shutdown" marker, which is a superset (it also covers benign terminations). |

## `Apps/<AppName>/` — per-app window logs

Each Overwolf app logs **per window**, one file per HTML window, rotated across
sessions:

| Pattern | Meaning |
|---|---|
| `background.html.log` | The background/controller window — always-on, no UI. Most diagnostic value (services, sync, auth, game state live here). |
| `in_game.html.log` | The in-game overlay window. |
| `desktop.html.log` / `launcher.html.log` | Desktop/launcher UI windows. |
| `auth.html.log` | A dedicated auth/login window, if the app uses one. |
| `<window>.html.<N>.log` | **Rotated** older session of that window (`.1` = previous, `.2` = older). The file with **no number** is the current session. |

Folders under `Apps/` whose name starts with **"Overwolf "** (e.g. `Overwolf
notifications`, `Overwolf promotions`, `Overwolf General GameEvents Provider`,
`Overwolf Remote Configurations`) are **Overwolf's own** system apps, not the
developer's app. The developer's app is the non-"Overwolf" folder (the parser picks
the largest such folder as the *primary app*).

## `Apps/Overwolf General GameEvents Provider/` — what GEP actually sent

GEP's own logs (`index.html.log`, rotated `index.html.<N>.log`; one provider process
per file, started for each game launch) are the ground truth for "did the app get the
game data?". They are app-agnostic — GEP is Overwolf's, not the app's — and they record:

| Line | Meaning |
|---|---|
| `Detected Gep Version X` (WARN), `Game Service Initialized vX`, older `[GEP] Running version X` | The GEP version for that provider run. The WARN level is routine. |
| `Running Game Id detected, gameId: N` / `game launched detected, N` | A game session starts. |
| `[GEP] info update {"featureName","categoryName","key","value"}` | An info update GEP **forwarded to apps**. `value: null` is a reset (e.g. `match_outcome` at every `match_start`), not a delivery. |
| `[GEP] New Event {"gameId","feature","key","value"}` | An event GEP forwarded to apps. |
| `[Plugin] info update {"category","key","value"}` / `[Plugin] New Event {"name"}` | What GEP's **native game plugin** produced, before GEP maps it to features. The plugin producing a key GEP never forwards points at GEP's mapping; the plugin producing nothing points at the game integration. |
| `[GEP] Supported game ended N`, `Stopping Game Handler N` | The game session ends. |
| `Missing feature (info\|event) - gameId: N (Game) - key` | At game close, GEP lists the keys it never produced this session and reports them to Overwolf. Some keys are listed in every session (per-slot or mode-specific keys) and mean nothing on their own; a key that **stopped** arriving is the finding. |

The doctor turns these into the diagnosis's `gep` section: per-session delivery counts,
the GEP version history, and `dropouts` — keys delivered in an earlier comparable
session of the same game and never in a later one.

## Log line format (shared by all apps)

Overwolf's logger writes lines like:

```
2026-01-01 12:00:04,100 (INFO) sync.js (:120) - [SyncService/run] Initial sync complete: 0 records pushed
```

- `2026-01-01 12:00:04,100` — local timestamp (comma before milliseconds).
- `(INFO)` — level: `INFO` / `WARN` / `ERROR` (also `DEBUG`/`TRACE`/`FATAL`).
- `sync.js (:120)` — source file/line (varies per app).
- `[SyncService/run]` — a component/function tag the app chose (varies per app).
- The rest is the message. Multi-line messages (stack traces, pretty JSON) continue
  on following lines until the next timestamped line.

Sessions within a file are separated by a marker line:

```
================== new session ==================
```
