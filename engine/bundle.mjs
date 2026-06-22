// Understands the on-disk shape of an Overwolf "send logs" bundle: the platform
// files at the root and the per-app log folders under Apps/. Categorizes every
// file and picks the primary (non-Overwolf) app. Read-only filesystem access.

import { readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

/** @typedef {"platform-trace"|"crash"|"crash-dump"|"browser-crash"|"updater"|"perf"|"service"|"app-log"|"system-app-log"|"other"} FileCategory */

/**
 * @typedef {Object} BundleFile
 * @property {string} path      Absolute path.
 * @property {string} rel       Path relative to the bundle root.
 * @property {string} name      Base file name.
 * @property {number} size      Bytes.
 * @property {FileCategory} category
 * @property {string|null} app  Owning app folder name (under Apps/), else null.
 * @property {string|null} window  App window ("background", "auth", ...), else null.
 * @property {number|null} rotation Rotation index (0 = current, 1 = .1.log, ...).
 */

/** App folders that ship with Overwolf itself (not the developer's app). */
// Apps that ship with Overwolf itself (not the developer's app). Besides the
// "Overwolf …" prefix, several platform helpers have plain names.
// Single-source the GEP-provider arm so isGepProviderApp() and the system-app
// classifier share one pattern and can't drift.
const GEP_PROVIDER = "game ?events? ?provider";
const GEP_PROVIDER_RE = new RegExp(GEP_PROVIDER, "i");
const SYSTEM_APP_PREFIX = new RegExp(`^overwolf\\b|${GEP_PROVIDER}|launcher ?events? ?provider|remote configurations?`, "i");

/** True if an Apps/<name> folder is an Overwolf-provided app, not a developer app. */
export function isPlatformApp(name) {
  return SYSTEM_APP_PREFIX.test(String(name));
}

/** True for Overwolf's General GameEvents Provider specifically — the platform
 * app whose logs carry the GEP version (`[GEP] Running version X`). Shares its
 * pattern (GEP_PROVIDER) with SYSTEM_APP_PREFIX's GEP arm so they can't drift. */
export function isGepProviderApp(name) {
  return GEP_PROVIDER_RE.test(String(name ?? ""));
}

/** Recursively list files under a directory. */
function walk(root, dir = root, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(root, full, acc);
    } else if (ent.isFile()) {
      let size = 0;
      try {
        size = statSync(full).size;
      } catch {
        /* ignore unreadable */
      }
      acc.push({ path: full, rel: relative(root, full), name: ent.name, size });
    }
  }
  return acc;
}

/** Parse "background.html.2.log" -> { window: "background", rotation: 2 }. */
function parseAppLogName(name) {
  const m = /^(?<window>.+?\.html)(?:\.(?<rot>\d+))?\.log$/i.exec(name);
  if (!m || !m.groups) return null;
  const window = m.groups.window.replace(/\.html$/i, "");
  const rotation = m.groups.rot ? Number(m.groups.rot) : 0;
  return { window, rotation };
}

/**
 * @param {string} rel
 * @param {string} name
 * @returns {{category: FileCategory, app: string|null, window: string|null, rotation: number|null}}
 */
function categorize(rel, name) {
  const parts = rel.split(/[\\/]/);
  const appsIdx = parts.findIndex((p) => p.toLowerCase() === "apps");
  if (appsIdx !== -1 && parts.length > appsIdx + 2) {
    const app = parts[appsIdx + 1];
    const log = parseAppLogName(name);
    const system = SYSTEM_APP_PREFIX.test(app);
    return {
      category: system ? "system-app-log" : "app-log",
      app,
      window: log?.window ?? null,
      rotation: log?.rotation ?? null,
    };
  }
  const lower = name.toLowerCase();
  /** @type {FileCategory} */
  let category = "other";
  if (/^(installer)?trace_.*\.log$/i.test(name)) category = "platform-trace";
  else if (lower === "crash.json" || lower === "exceptiondetails.txt") category = "crash";
  else if (/\.game\.html$/i.test(name)) category = "crash-dump";
  // CEF sub-process crash log written when a renderer/GPU process dies. Its
  // command line names the app+window (--owapp / --type=renderer) and it carries
  // the native fault (e.g. an SEHException in libcef). One per crashed process.
  else if (/^overwolfbrowsererror.*\.log$/i.test(name)) category = "browser-crash";
  else if (lower === "overwolfupdater.log") category = "updater";
  else if (lower === "overwolfperf.txt") category = "perf";
  else if (lower === "serviceinstall.log") category = "service";
  return { category, app: null, window: null, rotation: null };
}

/**
 * Build an inventory of a bundle directory.
 * @param {string} dir
 * @returns {{ valid: boolean, root: string, files: BundleFile[], apps: {name: string, system: boolean, bytes: number, files: BundleFile[]}[], primaryApp: string|null }}
 */
export function readBundle(dir) {
  const files = walk(dir).map((f) => ({ ...f, ...categorize(f.rel, f.name) }));

  /** @type {Map<string, {name: string, system: boolean, bytes: number, files: BundleFile[]}>} */
  const appMap = new Map();
  for (const f of files) {
    if (!f.app) continue;
    const a = appMap.get(f.app) ?? {
      name: f.app,
      system: SYSTEM_APP_PREFIX.test(f.app),
      bytes: 0,
      files: [],
    };
    a.bytes += f.size;
    a.files.push(f);
    appMap.set(f.app, a);
  }
  const apps = [...appMap.values()];

  // The developer's app is the non-system app folder; if several, the largest.
  const primaryApp =
    apps
      .filter((a) => !a.system)
      .sort((a, b) => b.bytes - a.bytes)[0]?.name ?? null;

  // A directory is a plausible bundle if it has platform traces or any app logs.
  const valid = files.some(
    (f) => f.category === "platform-trace" || f.category === "app-log" || f.category === "system-app-log",
  );

  return { valid, root: dir, files, apps, primaryApp };
}

/** Human label for a bundle file, used in reports. */
export function fileLabel(f) {
  if (f.app) return `Apps/${f.app}/${f.name}`;
  return f.rel.split(sep).join("/") || basename(f.path);
}
