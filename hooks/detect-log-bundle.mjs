// UserPromptSubmit hook: when the user's prompt contains what looks like an
// Overwolf support-log bundle path, inject a reminder to invoke the
// overwolf-log-doctor skill instead of opening the bundle by hand.
//
// Why a hook when the skill description already says "use when given a bundle":
// in a real session the agent's skill check happens once per user message, and
// when bundles arrive as side evidence inside a broader question ("crashes are
// up, here are the only bundles we got") that one check gets spent on a
// process-level skill and the bundles get treated as plain zip files. Prose
// adherence is probabilistic; a deterministic reminder at prompt time is not.

import { pathToFileURL } from "node:url";

// Overwolf's log uploader names bundles
// `<free-text>_<YYYY-MM-DD>_<HH-MM-SS>_<appVersion>_<shortcode>.zip`
// (see references/bundle-anatomy.md). The `_<date>_<time>_` core is the
// discriminator; the prefix/suffix just have to look like path segments.
const BUNDLE_PATH_RE = /[^\s"'<>|]*_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[^\s"'<>|]*\.zip/gi;

/**
 * Find Overwolf-bundle-shaped .zip paths in free text.
 * @param {string} text
 * @returns {string[]} matches, deduplicated, in order of first appearance
 */
export const detectBundlePaths = (text) => [...new Set(text.match(BUNDLE_PATH_RE) ?? [])];

/**
 * Build the context block injected into the conversation.
 * @param {string[]} bundles
 * @returns {string}
 */
export const buildReminder = (bundles) => {
  const names = bundles.map((p) => p.split(/[\\/]/).pop()).join(", ");
  return (
    `The prompt references ${bundles.length} Overwolf support-log bundle(s): ${names}. ` +
    "Invoke the overwolf-log-doctor skill to triage them — even when the bundles are only " +
    "side evidence in a broader investigation (crash spike, version regression, missing or " +
    "scarce log uploads). Do not unzip, list, or read bundle contents by hand first. If the " +
    "project defines a log-doctor rules pack, pass it via --rules."
  );
};

const main = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  /** @type {string} */
  let prompt = "";
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    // Claude Code sends the prompt as `prompt`; older docs say `user_prompt`.
    const candidate = input.prompt ?? input.user_prompt;
    if (typeof candidate === "string") prompt = candidate;
  } catch {
    // Malformed/missing stdin: stay silent — this hook must never break a prompt.
  }
  const bundles = detectBundlePaths(prompt);
  if (bundles.length === 0) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: buildReminder(bundles),
      },
    }),
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
