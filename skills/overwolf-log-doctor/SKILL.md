---
name: overwolf-log-doctor
description: Use when given an Overwolf app support-log bundle (a .zip from the app's "send logs" feature, or an extracted folder) to triage a user-reported problem — syncing, login/auth, game events (GEP), crashes, updates, network, or "it says X but it isn't working". Parses the bundle, surfaces ranked signals, and proposes likely causes plus next steps. Works for any Overwolf app.
---

# Overwolf Log Doctor

Diagnose an Overwolf app's support-log bundle and turn it into a ranked, actionable
report. The heavy lifting is done by a zero-dependency parser in this plugin; your
job is to run it, interpret the signals, and recommend next steps.

## Privacy first

A bundle contains a real end user's data (email, account id, game handle, file
paths). **Never paste raw log content or un-redacted identifiers into anything that
leaves the developer's machine** (tickets, chat, issues). Use the `--redact` flag for
anything shareable, and mask identifiers yourself when quoting lines.

## Steps

1. **Get the bundle path, the complaint, and WHICH app is the developer's.** A bundle
   usually contains several apps — the developer's app, Overwolf's own helper apps, and
   unrelated third-party apps. You must know which app the developer owns, because the
   bug is usually in *their* app and they don't care about other apps' bugs. Determine
   it from context (the repo/conversation), or run once without `--app` to see the app
   list (`bundle.apps` / `otherApps`) and confirm with the user. Also note the complaint
   and any app version/timestamp in the zip filename.

2. **Run the parser, scoped to the developer's app.** It extracts the zip itself and
   prints a structured diagnosis. Pass `--app` so it focuses on their app + Overwolf and
   ignores other apps:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" "<path-to-zip-or-folder>" --app "<AppName>" --json
   ```

   - Add `--rules <path>` if the app team has an external rule pack of app-specific
     detectors (see `references/extending-detectors.md`).
   - Use `--report` instead of `--json` for a quick human-readable view.
   - The JSON has: `bundle`, `ownedApp` (which app was scoped to, and whether it was
     inferred), `environment`, `topErrors` / `topWarnings` (the developer app's distinct
     messages, clustered + counted, **background/main window weighted** — the headline),
     `platformErrors` (Overwolf's own errors — could be the source), `otherApps` (counts
     for apps the developer doesn't own — ignore these), `signals`, `correlations`,
     `timeline`.

3. **Ground yourself in the platform model.** If you're unsure what a window, the
   Game Events Provider, or the bundle layout means, load the primer:
   @${CLAUDE_PLUGIN_ROOT}/references/overwolf-platform-primer.md

4. **Interpret the signals** using the playbook (what each signal means and what to
   do about it):
   @${CLAUDE_PLUGIN_ROOT}/references/signal-playbook.md

   Bundle anatomy (what each file is) if you need it:
   @${CLAUDE_PLUGIN_ROOT}/references/bundle-anatomy.md

5. **Rank by relevance, with these rules of thumb:**
   - **Their app vs. Overwolf.** Lead with `topErrors`/`topWarnings` (the developer's
     app). Use `platformErrors` to decide if the root cause is actually **Overwolf**
     (e.g. GEP shutdowns, failed downloads to apps.overwolf.com, updater issues) rather
     than their code — say so explicitly when it is. **Ignore `otherApps`** entirely
     (just mention they were present and skipped).
   - **Background/main + recent first.** The background/main window holds the business
     logic (Overwolf best practice), so weight those errors highest — the parser already
     does this — and prefer the **most recent** occurrences (check each cluster's
     `lastTs`; the current, un-rotated `background.html.log` is where a freshly-reported
     bug lives). Treat launcher/in-game UI-window noise (autoplay/fullscreen/CSP) as
     usually secondary unless the complaint is about the overlay/UI.
   - **Match the complaint.** The filename complaint is the user's *guess*. A reported
     bug is often **low-frequency** (it just happened once), so don't assume the most
     frequent error is the reported one — scan `topErrors` (especially recent
     background-window entries) for something matching the complaint, and also report the
     dominant issues you find even if the user didn't mention them.

6. **Write the report.** Structure it as:
   - **Summary** — one or two sentences: most likely cause(s), confidence.
   - **Environment** — app/Overwolf version, OS, last session window.
   - **Findings** — ranked, each with: what the logs show (a masked example line),
     what it means, and how confident you are.
   - **Recommended next steps** — split into *developer checks* (what to investigate
     or instrument) and *what to tell the end user*.

7. **Offer a redacted ticket summary.** Produce a short, copy-pasteable summary safe
   to attach to a support ticket. Generate it with `--redact` and double-check no PII
   remains before sharing.

## Notes & limits

- Detectors are **generic** (keyword/pattern based) and best-effort — absence of a
  signal is not proof something is fine. Read the `timeline` for context.
- Timestamps are the user's local wall-clock time, as written in the logs.
- This skill never modifies the bundle and never uploads it anywhere.
- Found a recurring pattern worth detecting automatically? Add a detector
  (see `references/extending-detectors.md`) and open a PR — that's how this improves.
