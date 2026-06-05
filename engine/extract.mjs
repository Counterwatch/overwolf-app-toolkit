// Turns a CLI input into a directory to analyze. A directory is used as-is; a
// .zip is extracted to a fresh temp dir using whatever archive tool the host
// already has, so the engine itself stays zero-dependency.
//
// Security note: extraction is delegated to the host tools (Expand-Archive / unzip /
// bsdtar / ditto). All of these reject path-traversal ("zip slip") entries in current
// versions — Expand-Archive uses .NET's ZipFile which validates entry paths, and
// Info-ZIP unzip/bsdtar refuse "../" escapes. We still extract into a fresh, empty
// mkdtemp dir so any stray entry stays contained. If you must process an untrusted
// archive, prefer extracting it yourself and passing the resulting folder.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Try a sequence of host extractors until one succeeds. */
function runFirstAvailable(commands) {
  const tried = [];
  for (const { cmd, args } of commands) {
    const res = spawnSync(cmd, args, { stdio: "ignore" });
    if (res.error) {
      // ENOENT = tool not installed; any other spawn error (EACCES, etc.) — either
      // way, record why and try the next extractor.
      tried.push(`${cmd} (${res.error.code ?? "spawn error"})`);
      continue;
    }
    if (res.status === 0) return { ok: true };
    tried.push(`${cmd} (exit ${res.status ?? "?"})`);
  }
  return { ok: false, tried };
}

/**
 * @param {string} zipPath
 * @param {string} destDir
 */
function extractZip(zipPath, destDir) {
  const commands =
    process.platform === "win32"
      ? [
          {
            cmd: "powershell",
            args: [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
            ],
          },
        ]
      : [
          { cmd: "unzip", args: ["-o", "-q", zipPath, "-d", destDir] },
          { cmd: "bsdtar", args: ["-xf", zipPath, "-C", destDir] },
          { cmd: "ditto", args: ["-x", "-k", zipPath, destDir] },
        ];

  const result = runFirstAvailable(commands);
  if (!result.ok) {
    throw new Error(
      `Could not extract "${zipPath}". Tried: ${result.tried.join(", ")}.\n` +
        `Extract it manually and pass the resulting folder instead.`,
    );
  }
}

/**
 * Resolve an input path to an analyzable directory.
 * @param {string} inputPath
 * @returns {{ dir: string, extracted: boolean, cleanup: () => void }}
 */
export function resolveBundleDir(inputPath) {
  const st = statSync(inputPath); // throws a clear ENOENT if missing
  if (st.isDirectory()) {
    return { dir: inputPath, extracted: false, cleanup: () => {} };
  }
  if (!/\.zip$/i.test(inputPath)) {
    throw new Error(`Expected a directory or a .zip file, got: ${inputPath}`);
  }
  const dest = mkdtempSync(join(tmpdir(), "owlog-extract-"));
  extractZip(inputPath, dest);
  return {
    dir: dest,
    extracted: true,
    cleanup: () => {
      try {
        rmSync(dest, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}
