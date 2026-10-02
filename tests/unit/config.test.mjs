import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { findQtTool } from "../../tools/qt-tool.mjs";

const CONTENTS = resolve(import.meta.dirname, "../../package/contents");
const KCFG = resolve(CONTENTS, "config/main.xml");
const UI = resolve(CONTENTS, "ui/config.ui");

test("every config entry has a widget in the config dialog and vice versa", () => {
  const entries = [...readFileSync(KCFG, "utf8").matchAll(/<entry name="(\w+)"/g)].map((m) => m[1]);
  const widgets = [...readFileSync(UI, "utf8").matchAll(/name="kcfg_(\w+)"/g)].map((m) => m[1]);

  assert.deepEqual(widgets.toSorted(), entries.toSorted());
});

test("the config dialog compiles", (t) => {
  let uic;
  try {
    uic = findQtTool("uic", "UIC");
  } catch {
    t.skip("uic not found");
    return;
  }
  execFileSync(uic, [UI], { stdio: "ignore" });
});
