// Spec 5.2: `Meta+N` shows workspace N on the monitor it lives on.

import assert from "node:assert/strict";
import { test } from "node:test";
import { sleep, startKwin } from "./harness.mjs";
import { locations, shownDesktops } from "./state.mjs";

function switchTo(kwin, number) {
  return kwin.invokeShortcut(`plasma-i3-desktops: Switch to workspace ${number}`);
}

async function waitForShown(kwin, expected) {
  return kwin.waitFor(
    async () => {
      const state = await kwin.state();
      return JSON.stringify(shownDesktops(state)) === JSON.stringify(expected) && state;
    },
    { message: `outputs did not show ${JSON.stringify(expected)}` },
  );
}

/** Switches, then gives the script time to act, for checks that nothing changed. */
async function switchAndSettle(kwin, number) {
  await switchTo(kwin, number);
  await kwin.waitForLog(new RegExp(`switch to workspace ${number}`));
  await sleep(200);
}

test(
  "an empty workspace appears on the current monitor (scenario 2)",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());

    await switchTo(kwin, 3);

    const state = await waitForShown(kwin, { "Virtual-0": 3, "Virtual-1": 2 });
    // Workspace 1 was left behind empty, so it is forgotten (spec 5.2, step 5).
    assert.deepEqual(locations(state), { 2: "Virtual-1", 3: "Virtual-0" });
  },
);

test("switching to the workspace already shown does nothing", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin();
  t.after(() => kwin.stop());

  await switchAndSettle(kwin, 1);

  assert.deepEqual(shownDesktops(await kwin.state()), { "Virtual-0": 1, "Virtual-1": 2 });
  assert.match(kwin.log(), /switch to workspace 1: nothing to do/);
});

test("a workspace hidden on the other monitor is shown there", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin();
  t.after(() => kwin.stop());
  await kwin.spawnWindow("B");
  await kwin.act(
    { sendToScreen: { caption: "B", output: "Virtual-1" } },
    { setDesktops: { caption: "B", desktops: [4] } },
  );
  await kwin.waitFor(async () => locations(await kwin.state())[4] === "Virtual-1");

  await switchTo(kwin, 4);

  await waitForShown(kwin, { "Virtual-0": 1, "Virtual-1": 4 });
});

test("a workspace shown on the other monitor stays there", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin();
  t.after(() => kwin.stop());

  await switchAndSettle(kwin, 2);

  assert.deepEqual(shownDesktops(await kwin.state()), { "Virtual-0": 1, "Virtual-1": 2 });
});

test(
  "with fewer than 10 desktops, the shortcuts beyond them do nothing",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin({ config: { kwinrc: { Desktops: { Number: 5 } } } });
    t.after(() => kwin.stop());
    await kwin.waitForLog(/only 5 virtual desktops/);

    await switchAndSettle(kwin, 7);

    assert.deepEqual(shownDesktops(await kwin.state()), { "Virtual-0": 1, "Virtual-1": 2 });
  },
);

test("does nothing with per-screen desktops off", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin({ perOutputDesktops: false });
  t.after(() => kwin.stop());

  await switchTo(kwin, 3);
  await sleep(300);

  assert.deepEqual(shownDesktops(await kwin.state()), { "Virtual-0": 1, "Virtual-1": 1 });
});
