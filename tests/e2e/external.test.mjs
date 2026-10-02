// Spec 5.6, 5.7, 6.8: what users do through Plasma and KWin rather than the
// script's shortcuts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BTN_LEFT, KEY_LEFTMETA } from "./fakeinput.mjs";
import { startKwin } from "./harness.mjs";
import { desktopNumbers, locations, windowTitled } from "./state.mjs";

/** Window A focused on Virtual-0 (workspace 1), B on Virtual-1 (workspace 2). */
async function twoWindows(kwin) {
  await kwin.spawnWindow("A");
  await kwin.spawnWindow("B");
  await kwin.act(
    { sendToScreen: { caption: "B", output: "Virtual-1" } },
    { activate: "A" },
    { shortcut: "MoveMouseToFocus" },
  );
  return kwin.waitFor(async () => {
    const state = await kwin.state();
    return locations(state)[2] === "Virtual-1" && state.activeScreen === "Virtual-0" && state;
  });
}

async function waitForWindowOn(kwin, caption, output, desktop) {
  return kwin.waitFor(
    async () => {
      const state = await kwin.state();
      const window = windowTitled(state, caption);
      return window.output === output && desktopNumbers(state, window)[0] === desktop && state;
    },
    { message: `${caption} did not end up on ${output}, workspace ${desktop}` },
  );
}

test(
  "a window sent to a workspace of the other monitor goes there, focus stays",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    const before = await twoWindows(kwin);

    await kwin.invokeShortcut("Window to Desktop 2");

    const state = await waitForWindowOn(kwin, "A", "Virtual-1", 2);
    assert.deepEqual(desktopNumbers(state, windowTitled(state, "A")), [2]);
    assert.equal(state.activeScreen, "Virtual-0");
    assert.deepEqual(state.cursor, before.cursor);
  },
);

test(
  "a window sent to the other monitor joins the workspace shown there",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await twoWindows(kwin);

    await kwin.invokeShortcut("Window to Next Screen");

    const state = await waitForWindowOn(kwin, "A", "Virtual-1", 2);
    assert.equal(locations(state)[2], "Virtual-1");
  },
);

test(
  "a window dragged to the other monitor joins the workspace shown there (scenario 10)",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await twoWindows(kwin);

    // Meta+drag moves a window in KWin; the pointer is on A.
    await kwin.keyboardKey(KEY_LEFTMETA, true);
    await kwin.pointerButton(BTN_LEFT, true);
    for (let step = 0; step < 10; step++) {
      await kwin.movePointer(192, 0);
    }
    await kwin.pointerButton(BTN_LEFT, false);
    await kwin.keyboardKey(KEY_LEFTMETA, false);

    const state = await waitForWindowOn(kwin, "A", "Virtual-1", 2);
    assert.equal(locations(state)[2], "Virtual-1");
  },
);
