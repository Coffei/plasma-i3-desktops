import assert from "node:assert/strict";
import { test } from "node:test";
import { SCRIPT_ID, startKwin } from "./harness.mjs";

const ANY_OUTPUT = /plasma-i3-desktops:/;
const ACTIVE = /plasma-i3-desktops: active/;
const INACTIVE = /plasma-i3-desktops: inactive/;
const DEBUG = { kwinrc: { [`Script-${SCRIPT_ID}`]: { Debug: true } } };

test("logs nothing with debug off", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin();
  t.after(() => kwin.stop());

  assert.doesNotMatch(kwin.log(), ANY_OUTPUT);
});

test("logs that it is active with debug on", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin({ config: DEBUG });
  t.after(() => kwin.stop());

  await kwin.waitForLog(ACTIVE);
  assert.doesNotMatch(kwin.log(), INACTIVE);
  assert.equal(kwin.log().match(/plasma-i3-desktops: active/g).length, 1, "reported once");
});

test("warns when per-screen desktops are off", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin({ perOutputDesktops: false, config: DEBUG });
  t.after(() => kwin.stop());

  await kwin.waitForLog(INACTIVE);
  assert.doesNotMatch(kwin.log(), ACTIVE);
});

test("follows per-screen desktops being turned on and off", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin({ perOutputDesktops: false, config: DEBUG });
  t.after(() => kwin.stop());
  await kwin.waitForLog(INACTIVE);

  await kwin.setConfig("kwinrc", "Windows", "PerOutputVirtualDesktops", true);
  await kwin.reconfigure();
  await kwin.waitForLog(ACTIVE);

  await kwin.setConfig("kwinrc", "Windows", "PerOutputVirtualDesktops", false);
  await kwin.reconfigure();
  await kwin.waitFor(() => kwin.log().match(/plasma-i3-desktops: inactive/g)?.length === 2, {
    message: "second inactive warning missing",
  });
});
