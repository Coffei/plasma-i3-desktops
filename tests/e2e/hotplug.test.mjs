// Spec 5.4, 5.5 and 6.7: monitors coming and going.

import assert from "node:assert/strict";
import { test } from "node:test";
import { SCRIPT_ID, sleep, startKwin } from "./harness.mjs";
import { desktopNumbers, homes, locations, shownDesktops, windowTitled } from "./state.mjs";
import { moveWorkspace, switchTo, waitForShown } from "./workspaces.mjs";

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

async function unplugAndReplug(kwin, output, whileAway = async () => {}) {
  await kwin.setOutputEnabled(output, false);
  await kwin.waitForOutputsSettled();
  await whileAway();
  await kwin.setOutputEnabled(output, true);
  await kwin.waitForOutputsSettled();
  return kwin.state();
}

test(
  "replugging brings the workspaces back, focus stays (scenario 7)",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await threeWorkspaces(kwin);
    const before = await kwin.state();

    const state = await unplugAndReplug(kwin, "Virtual-1");

    assert.deepEqual(locations(state), { 1: "Virtual-0", 2: "Virtual-1", 3: "Virtual-1" });
    assert.deepEqual(homes(state), locations(state));
    assert.deepEqual(shownDesktops(state), { "Virtual-0": 1, "Virtual-1": 2 });
    for (const [caption, desktop] of [
      ["B", 2],
      ["C", 3],
    ]) {
      const window = windowTitled(state, caption);
      assert.equal(window.output, "Virtual-1");
      assert.deepEqual(desktopNumbers(state, window), [desktop]);
    }
    assert.equal(state.activeScreen, "Virtual-0");
    assert.deepEqual(state.cursor, before.cursor);
  },
);

test(
  "a workspace emptied while its monitor is away does not return (scenario 8)",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await threeWorkspaces(kwin);

    const state = await unplugAndReplug(kwin, "Virtual-1", async () => {
      await kwin.closeWindow("C");
      await kwin.waitFor(async () => locations(await kwin.state())[3] === undefined);
    });

    assert.deepEqual(locations(state), { 1: "Virtual-0", 2: "Virtual-1" });
  },
);

test(
  "a workspace moved while its monitor is away stays where it was moved",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin({ outputs: 3 });
    t.after(() => kwin.stop());
    await kwin.spawnWindow("A");
    await kwin.spawnWindow("B");
    await kwin.act(
      { sendToScreen: { caption: "B", output: "Virtual-1" } },
      { activate: "A" },
      { shortcut: "MoveMouseToFocus" },
    );
    await kwin.waitFor(async () => {
      const s = await kwin.state();
      return locations(s)[2] === "Virtual-1" && s.activeScreen === "Virtual-0";
    });

    const state = await unplugAndReplug(kwin, "Virtual-1", async () => {
      await switchTo(kwin, 2);
      await waitForShown(kwin, { "Virtual-0": 2, "Virtual-2": 3 });
      // Virtual-1 is gone, so Virtual-2 is now the neighbour on the right.
      await moveWorkspace(kwin, "right");
      await kwin.waitForWindow("B", (w) => w.output === "Virtual-2");
    });

    const b = windowTitled(state, "B");
    assert.equal(b.output, "Virtual-2", "B went back after KWin restored it to Virtual-1");
    assert.deepEqual(desktopNumbers(state, b), [2]);
    assert.equal(locations(state)[2], "Virtual-2");
    assert.equal(homes(state)[2], "Virtual-2");
    assert.equal(shownDesktops(state)["Virtual-2"], 2);
    assert.notEqual(shownDesktops(state)["Virtual-1"], 2);
  },
);

test(
  "a brand-new monitor gets a free workspace and nothing moves to it",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin({ outputs: 3 });
    t.after(() => kwin.stop());
    await kwin.spawnWindow("A");
    await kwin.unloadScript();
    await kwin.setOutputEnabled("Virtual-2", false);
    await kwin.loadScript();
    const before = await kwin.state();

    await kwin.setOutputEnabled("Virtual-2", true);
    await kwin.waitForOutputsSettled();

    const state = await kwin.state();
    const shown = shownDesktops(state);
    assert.deepEqual(locations(before), { 1: "Virtual-0", 2: "Virtual-1" });
    assert.ok(![1, 2].includes(shown["Virtual-2"]), "Virtual-2 shows a workspace of its own");
    assert.equal(locations(state)[shown["Virtual-2"]], "Virtual-2");
    assert.equal(windowTitled(state, "A").output, "Virtual-0");
    assert.equal(state.activeScreen, before.activeScreen);
  },
);
