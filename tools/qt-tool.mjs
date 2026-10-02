// Locates Qt command line tools, which most distributions keep outside PATH.

import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

const QT_BIN_DIRS = [
  "/usr/lib64/qt6/bin",
  "/usr/lib64/qt6/libexec",
  "/usr/lib/qt6/bin",
  "/usr/lib/qt6/libexec",
  "/usr/lib/x86_64-linux-gnu/qt6/bin",
  "/usr/lib/x86_64-linux-gnu/qt6/libexec",
];

/**
 * Finds the Qt 6 tool `name` (e.g. `qml`, `qmlformat`).
 *
 * The environment variable `envVar` wins if set; then PATH is searched for
 * `name6` and `name`; then the usual Qt 6 bin and libexec directories.
 */
export function findQtTool(name, envVar) {
  if (envVar && process.env[envVar]) {
    return process.env[envVar];
  }
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const candidates = [
    ...pathDirs.flatMap((dir) => [join(dir, `${name}6`), join(dir, name)]),
    ...QT_BIN_DIRS.map((dir) => join(dir, name)),
  ];
  const found = candidates.find(isExecutable);
  if (!found) {
    throw new Error(`Qt tool "${name}" not found; set ${envVar ?? "PATH"} to point to it`);
  }
  return found;
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
