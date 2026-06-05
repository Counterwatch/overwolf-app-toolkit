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

1. **Get the bundle path and the complaint.** Ask the user for the path to the `.zip`
   (or an already-extracted folder) and a one-line description of what the user
   reported. Note any app version / timestamp encoded in the zip filename.

2. **Run the parser.** It extracts the zip itself (via the host's unzip) and prints a
   structured diagnosis. Prefer JSON for your own analysis:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" "<path-to-zip-or-folder>" --json
   ```

   - Add `--rules <path>` if the app team has an external rule pack of app-specific
     detectors (see `references/extending-detectors.md`).
   - Use `--report` instead of `--json` for a quick human-readable view.
   - The JSON has: `bundle`, `environment`, `topErrors` / `topWarnings` (distinct
     messages clustered + counted, most frequent first — usually the headline),
     `signals` (category counts ranked by severity), `correlations`, and a `timeline`.

3. **Ground yourself in the platform model.** If you're unsure what a window, the
   Game Events Provider, or the bundle layout means, load the primer:
   @${CLAUDE_PLUGIN_ROOT}/references/overwolf-platform-primer.md

4. **Interpret the signals** using the playbook (what each signal means and what to
   do about it):
   @${CLAUDE_PLUGIN_ROOT}/references/signal-playbook.md

   Bundle anatomy (what each file is) if you need it:
   @${CLAUDE_PLUGIN_ROOT}/references/bundle-anatomy.md

5. **Rank by relevance to the complaint.** Lead with `topErrors` (the distinct,
   most-frequent error messages — often the real story even when the user's
   description is a downstream symptom), then the `correlations` and the signals
   most related to what the user reported. Note that the filename's complaint is
   the user's *guess*; let the clustered errors tell you what's actually dominating.

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
