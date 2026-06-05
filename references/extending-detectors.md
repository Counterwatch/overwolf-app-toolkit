# Extending the doctor: detectors & rule packs

The diagnosis is driven by **detectors** — small objects that match log lines and
roll them up into signals. There are two ways to add them.

## 1. Generic detectors (PR into this repo)

If a pattern is useful to **any** Overwolf app (a platform behavior, a common library
error, a connectivity symptom), add it to `engine/detectors.mjs` and a test to
`tests/detectors.test.mjs`, then open a PR.

**Hard rule:** generic detectors must match only **public, app-agnostic** concepts —
industry-standard keywords and documented Overwolf-platform terms. Never encode a
single app's proprietary log strings here.

## 2. App-specific rule packs (keep in YOUR repo, load with `--rules`)

Your app's own log strings (`[YourService/foo] …`, custom status messages) are
specific to you and should **not** live in the open-source toolkit. Put them in a rule
pack file in your own (possibly private) repository and load it at runtime:

```bash
node "${CLAUDE_PLUGIN_ROOT}/engine/cli.mjs" "<bundle>" --json --rules ./my-app-rules.mjs
```

A rule pack is an ES module exporting `detectors` (or a default array):

```js
// my-app-rules.mjs
export const detectors = [
  {
    id: "myapp-checkout-stall",            // unique id
    title: "Checkout stalled waiting for token",
    category: "auth",                       // free-form grouping label
    severity: "warn",                       // info | notice | warn | error | critical
    scope: "app",                           // "any" | "app" | "overwolf"
    match: (entry, ctx) =>                   // return true to flag this line
      /CheckoutService.*waiting for token/i.test(entry.message ?? ""),
    // optional: roll matching entries into structured data on the signal
    summarize: (entries) => ({ stalls: entries.length }),
  },
];
```

### The detector contract

- **`id`** (string, required) and **`match(entry, ctx)`** (function, required).
- **`entry`** is a parsed log line:
  `{ ts?: number, tsRaw?: string, level?: "INFO"|"WARN"|"ERROR"|…, component?: string|null, message?: string, raw: string }`.
  `ts` is epoch ms (may be absent); `message` excludes the timestamp/level prefix.
- **`ctx.file`** is `{ category, app, window, system }` where `category` is one of
  `platform-trace | updater | app-log | system-app-log | …`. Use it to target the
  right logs.
- **`scope`** filters which files reach `match`: `"app"` = the developer app's logs
  only; `"overwolf"` = platform/system logs; `"any"` = everything (default).
- **`severity`** is the floor; a matching `ERROR` line lifts the signal to `error`.
- **`summarize(entries)`** (optional) returns a plain object attached as `signal.data`.
  Keep patterns generic where you can; this is where app-specific extraction lives.

### Good practices

- One detector = one idea. Prefer several focused detectors over one mega-regex.
- Make `match` cheap and side-effect free; it runs against every in-scope line.
- Don't throw — the engine guards `match`, but a clean boolean is best.
- Add a fixture line + a test when contributing generic detectors.
