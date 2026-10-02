import assert from "node:assert/strict";
import { test } from "node:test";
import { startKwin } from "./harness.mjs";

const INACTIVE = /plasma-i3-desktops: inactive/;

test("stays quiet when per-screen desktops are on", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin();
  t.after(() => kwin.stop());

  assert.doesNotMatch(kwin.log(), INACTIVE);
});

test("warns when per-screen desktops are off", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin({ perOutputDesktops: false });
  t.after(() => kwin.stop());

  await kwin.waitForLog(INACTIVE);
});

test("warns when per-screen desktops are turned off at runtime", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin();
  t.after(() => kwin.stop());

  await kwin.setConfig("kwinrc", "Windows", "PerOutputVirtualDesktops", false);
  await kwin.reconfigure();

  await kwin.waitForLog(INACTIVE);
});
