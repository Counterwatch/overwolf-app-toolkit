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

1. Re-read the relevant pages on https://dev.overwolf.com (most primer sections link
   their source). If you have Overwolf's official docs MCP server (`ow-docs-mcp`), re-verify
   facts with the `mcp__ow-docs-mcp__algolia_search_index_overwolf` tool (faceting queries
   with `facet_docusaurus_tag: docs-ow-native-current`) — optional, not required.
2. Update the facts and links, correct anything that drifted, and bump the
   `Last synced:` date at the top.
3. Keep it concise — it's a fast first layer, not a copy of the docs.
4. **Re-check § 11 "Hard-won gotchas" against the pages that changed.** § 11 is the
   exception to the snapshot rule: it records field-verified behavior the docs *don't*
   state, so each entry needs a verification date and, where one exists, an upstream
   issue link. That also means entries rot in a direction the freshness canary can't
   see — when Overwolf documents a behavior, the gotcha becomes redundant even though
   nothing about it is wrong. A changed page is the moment to check: drop the entry, or
   narrow it to whatever is still undocumented and move the rest into the numbered
   section. (Example: the 2026-08 sync moved the `setRequiredFeatures` retry rule into
   § 7 once the docs stated it, leaving § 11 only the transient error strings.)
5. Accept the new freshness baseline:
   `node scripts/check-primer-freshness.mjs --update` (it hashes every cited page; the
   scheduled `primer-freshness` workflow compares against this baseline monthly and
   opens an issue when the live docs move). Adding a citation adds a page to the
   baseline, so only link pages you actually read.

## Releasing (version sync)

`npm version` bumps `package.json` only. The same version is also declared in
`.claude-plugin/plugin.json` and in the toolkit's entry in
`.claude-plugin/marketplace.json` — bump those with it (the console plugin's
`plugins/console/.claude-plugin/plugin.json` + its marketplace entry version
independently, but must match each other). CI and the release workflow enforce this via
`node scripts/check-version-sync.mjs`.

## Pull requests

- Branch from `main`; keep PRs focused.
- Ensure `node --test` is green.
- Describe the symptom/log shape your change addresses (with **synthetic** examples).
