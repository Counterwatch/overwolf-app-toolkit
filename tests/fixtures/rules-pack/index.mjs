// Example external rule pack. An app team keeps a file like this in THEIR OWN
// (possibly private) repo to teach the doctor about their app's specific log
// strings — these never live in the open-source toolkit. Loaded via --rules.

export const detectors = [
  {
    id: "example-app-custom",
    title: "Example app — custom widget activity",
    category: "app",
    severity: "info",
    scope: "app",
    match: (entry) => /CustomServiceXYZ/i.test(entry.message ?? ""),
  },
  {
    // The app's symptom depends on a GEP key: the diagnosis places each hit in its
    // GEP session and reports whether GEP delivered match_outcome there.
    id: "example-app-no-outcome",
    title: "Example app — match ended without an outcome",
    category: "game",
    severity: "warn",
    scope: "app",
    gepKeys: ["match_info.match_outcome"],
    match: (entry) => /Match ended with no outcome/i.test(entry.message ?? ""),
  },
];
