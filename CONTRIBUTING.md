# Contributing

Thanks for helping improve the Overwolf app toolkit! Issues and PRs are welcome —
including from Overwolf and from any app developer.

## Ground rules

- **No dependencies, no build step.** The `engine/` is plain ESM runnable with `node`.
- **Never include real user data.** Don't attach or commit a real support-log bundle,
  its files, or excerpts — they contain PII. Reproduce issues with synthetic data
  modeled on the public log format (see `tests/fixtures/sample-bundle/`).
- **Keep the open-source core app-agnostic.** Generic detectors only; app-specific log
  strings go in external rule packs (see below).

## Dev setup

```bash
git clone https://github.com/Counterwatch/overwolf-app-toolkit
cd overwolf-app-toolkit
node --test          # Node 20+; no install needed
```

## Adding a generic detector

1. Append a detector to `DETECTORS` in `engine/detectors.mjs`. Match only public,
   app-agnostic patterns. The contract is documented in
   `references/extending-detectors.md`.
2. Add a line to the fixture (`tests/fixtures/sample-bundle/...`) that exercises it and
   an assertion in `tests/detectors.test.mjs` or `tests/diagnose.test.mjs`.
3. `node --test` must pass.

## App-specific rules (stay in your repo)

If a pattern is unique to your app, keep it in your own (optionally private) repo as a
rule pack and load it with `--rules ./your-rules.mjs`. Don't PR app-specific strings
into this repo.

## Updating the Overwolf platform primer

`references/overwolf-platform-primer.md` is a distilled snapshot of the official docs.
To refresh it:

1. Re-read the relevant pages on https://dev.overwolf.com (each primer section links
   its source). If you have the Context7 MCP server, the same docs are the library
   `/websites/dev_overwolf` — optional, not required.
2. Update the facts and links, correct anything that drifted, and bump the
   `Last synced:` date at the top.
3. Keep it concise — it's a fast first layer, not a copy of the docs.

## Pull requests

- Branch from `main`; keep PRs focused.
- Ensure `node --test` is green.
- Describe the symptom/log shape your change addresses (with **synthetic** examples).
