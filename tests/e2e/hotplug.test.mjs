// Spec 5.4, 5.5 and 6.7: monitors coming and going.

import assert from "node:assert/strict";
import { test } from "node:test";
import { SCRIPT_ID, sleep, startKwin } from "./harness.mjs";
import { desktopNumbers, homes, locations, shownDesktops, windowTitled } from "./state.mjs";
import { switchTo } from "./workspaces.mjs";

function debounce(ms) {
  return { kwinrc: { [`Script-${SCRIPT_ID}`]: { HotplugDebounceMs: ms } } };
}

test(
  "an unplug and replug in quick succession is handled once, as no change (scenario 11)",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin({ config: debounce(1500) });
    t.after(() => kwin.stop());
    await kwin.spawnWindow("B");
    await kwin.act({ sendToScreen: { caption: "B", output: "Virtual-1" } });
    await kwin.waitFor(async () => locations(await kwin.state())[2] === "Virtual-1");
    const before = await kwin.state();

    await kwin.setOutputEnabled("Virtual-1", false);
    await switchTo(kwin, 3);
    await kwin.setOutputEnabled("Virtual-1", true);
    await kwin.waitForOutputsSettled();
    await sleep(300);

    const after = await kwin.state();
    assert.equal(kwin.settledCount(), 1);
    assert.match(kwin.log(), /outputs settled: unchanged/);
    assert.match(kwin.log(), /outputs are settling, ignoring switch to workspace 3/);
    assert.deepEqual(shownDesktops(after), shownDesktops(before));
    assert.deepEqual(locations(after), locations(before));
  },
);

/**
 * Window A on Virtual-0 (workspace 1, focused), B on Virtual-1 (workspace 2,
 * shown) and C on Virtual-1 (workspace 3, hidden).
 */
async function threeWorkspaces(kwin) {
  await kwin.spawnWindow("A");
  await kwin.spawnWindow("B");
  await kwin.spawnWindow("C");
  await kwin.act(
    { sendToScreen: { caption: "B", output: "Virtual-1" } },
    { sendToScreen: { caption: "C", output: "Virtual-1" } },
    { setDesktops: { caption: "C", desktops: [3] } },
    { activate: "A" },
    { shortcut: "MoveMouseToFocus" },
  );
  return kwin.waitFor(async () => {
    const state = await kwin.state();
    return locations(state)[3] === "Virtual-1" && state.activeScreen === "Virtual-0" && state;
  });
}

test(
  "unplugging a monitor moves its workspaces to the focused one (scenario 6)",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await threeWorkspaces(kwin);

    await kwin.setOutputEnabled("Virtual-1", false);
    await kwin.waitForOutputsSettled();

    const state = await kwin.state();
    assert.deepEqual(locations(state), { 1: "Virtual-0", 2: "Virtual-0", 3: "Virtual-0" });
    assert.deepEqual(homes(state), { 1: "Virtual-0", 2: "Virtual-1", 3: "Virtual-1" });
    assert.deepEqual(shownDesktops(state), { "Virtual-0": 1 }, "Virtual-0's view is unchanged");
    for (const [caption, desktop] of [
      ["B", 2],
      ["C", 3],
    ]) {
      const window = windowTitled(state, caption);
      assert.equal(window.output, "Virtual-0");
      assert.deepEqual(desktopNumbers(state, window), [desktop]);
    }
  },
);

test(
  "a workspace whose windows KWin spreads over two monitors is gathered on the focused one",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin({ outputs: 3 });
    t.after(() => kwin.stop());
    await kwin.spawnWindow("A");
    await kwin.spawnWindow("Left");
    await kwin.spawnWindow("Right");
    await kwin.act(
      { sendToScreen: { caption: "Left", output: "Virtual-1" } },
      { sendToScreen: { caption: "Right", output: "Virtual-1" } },
      { setGeometry: { caption: "Left", geometry: { x: 2020, y: 100, width: 400, height: 300 } } },
      { setGeometry: { caption: "Right", geometry: { x: 3340, y: 100, width: 400, height: 300 } } },
      { activate: "A" },
      { shortcut: "MoveMouseToFocus" },
    );
    await kwin.waitFor(async () => {
      const state = await kwin.state();
      return windowTitled(state, "Right").geometry.x === 3340 && state.activeScreen === "Virtual-0";
    });

    await kwin.setOutputEnabled("Virtual-1", false);
    await kwin.waitForOutputsSettled();

    const state = await kwin.state();
    for (const caption of ["Left", "Right"]) {
      const window = windowTitled(state, caption);
      assert.equal(window.output, "Virtual-0", `${caption} is on the focused output`);
      assert.deepEqual(desktopNumbers(state, window), [2], `${caption} kept its workspace`);
    }
    assert.equal(locations(state)[2], "Virtual-0");
    assert.equal(homes(state)[2], "Virtual-1");
  },
);
