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
