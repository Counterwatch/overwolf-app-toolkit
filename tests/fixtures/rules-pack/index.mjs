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
];
