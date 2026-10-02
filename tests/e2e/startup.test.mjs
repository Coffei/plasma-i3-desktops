// Spec 5.1: the script rebuilds where workspaces live from KWin's state.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startKwin } from "./harness.mjs";
import { desktopNumbers, locations, shownDesktops, windowTitled } from "./state.mjs";

test(
  "a workspace shown on both outputs stays on the focused one, the other gets a free one",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await kwin.unloadScript();
    await kwin.act(
      { showDesktop: { desktop: 1, output: "Virtual-0" } },
      { showDesktop: { desktop: 1, output: "Virtual-1" } },
    );

    await kwin.loadScript();

    const state = await kwin.state();
    assert.equal(state.activeScreen, "Virtual-0");
    assert.deepEqual(shownDesktops(state), { "Virtual-0": 1, "Virtual-1": 2 });
    assert.deepEqual(locations(state), { 1: "Virtual-0", 2: "Virtual-1" });
  },
);

test(
  "reloading the script rebuilds the model from windows on both outputs (scenario 12)",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await kwin.spawnWindow("A");
    await kwin.spawnWindow("B");
    await kwin.spawnWindow("C");
    await kwin.unloadScript();
    await kwin.act(
      { showDesktop: { desktop: 1, output: "Virtual-0" } },
      { showDesktop: { desktop: 2, output: "Virtual-1" } },
      { sendToScreen: { caption: "B", output: "Virtual-1" } },
      { sendToScreen: { caption: "C", output: "Virtual-1" } },
      { setDesktops: { caption: "C", desktops: [3] } },
    );

    await kwin.loadScript();

    const state = await kwin.state();
    assert.deepEqual(locations(state), { 1: "Virtual-0", 2: "Virtual-1", 3: "Virtual-1" });
    assert.deepEqual(shownDesktops(state), { "Virtual-0": 1, "Virtual-1": 2 });
  },
);

test(
  "a window away from its workspace adopts the workspace shown on its output",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await kwin.spawnWindow("A");
    await kwin.spawnWindow("B");
    await kwin.unloadScript();
    await kwin.act(
      { showDesktop: { desktop: 1, output: "Virtual-0" } },
      { showDesktop: { desktop: 2, output: "Virtual-1" } },
      { sendToScreen: { caption: "A", output: "Virtual-1" } },
      // B stays on Virtual-0, but joins A's workspace, which lives on Virtual-1.
      { setDesktops: { caption: "B", desktops: [2] } },
    );

    await kwin.loadScript();

    const state = await kwin.waitFor(async () => {
      const s = await kwin.state();
      return desktopNumbers(s, windowTitled(s, "B"))[0] === 1 && s;
    });
    assert.equal(windowTitled(state, "B").output, "Virtual-0");
    assert.deepEqual(locations(state), { 1: "Virtual-0", 2: "Virtual-1" });
  },
);

test("changes nothing with per-screen desktops off", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin({ perOutputDesktops: false });
  t.after(() => kwin.stop());

  const state = await kwin.state();

  assert.deepEqual(shownDesktops(state), { "Virtual-0": 1, "Virtual-1": 1 });
  assert.deepEqual(state.model.location, {});
});
