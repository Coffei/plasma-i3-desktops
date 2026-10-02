// Formats all QML files with qmlformat; with --check, only reports unformatted ones.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findQtTool } from "./qt-tool.mjs";

const ROOTS = ["package", "tests"];

const check = process.argv.includes("--check");
const qmlformat = findQtTool("qmlformat", "QMLFORMAT");
const files = ROOTS.flatMap((root) => qmlFiles(root));

if (check) {
  const unformatted = files.filter(
    (file) => execFileSync(qmlformat, [file], { encoding: "utf8" }) !== readFileSync(file, "utf8"),
  );
  for (const file of unformatted) {
    console.log(`[warn] ${file}`);
  }
  process.exitCode = unformatted.length ? 1 : 0;
} else if (files.length) {
  execFileSync(qmlformat, ["-i", ...files], { stdio: "inherit" });
}

function qmlFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".qml"))
    .map((entry) => join(entry.parentPath, entry.name));
}
