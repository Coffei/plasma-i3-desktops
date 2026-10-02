// KWin behaviour the pointer warp relies on (spec 6.1). These tests use only
// KWin itself, so they keep checking the assumption after KWin updates.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startKwin } from "./harness.mjs";

const CENTRE_0 = { x: 960, y: 540 };
const CENTRE_1 = { x: 2880, y: 540 };

async function focusAndWarp(kwin, params, expectedCursor) {
  await kwin.runProbe("focus-and-warp.qml", params);
  return kwin.waitFor(
    async () => {
      const state = await kwin.state();
      return isAt(state.cursor, expectedCursor) && state;
    },
    { message: `cursor did not reach ${JSON.stringify(expectedCursor)}` },
  );
}

function isAt(cursor, point) {
  return Math.abs(cursor.x - point.x) <= 1 && Math.abs(cursor.y - point.y) <= 1;
}

function centre(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

test(
  "Switch to Screen and MoveMouseToCenter focus an empty output",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    const before = await kwin.state();
    assert.equal(before.activeScreen, "Virtual-0");
    assert.deepEqual(before.screenOrder, ["Virtual-0", "Virtual-1"]);

    const state = await focusAndWarp(
      kwin,
      { shortcuts: ["Switch to Screen 1", "MoveMouseToCenter"] },
      CENTRE_1,
    );

    assert.equal(state.activeScreen, "Virtual-1");
  },
);

test(
  "a window opened after the warp lands on the warped-to output",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await focusAndWarp(kwin, { shortcuts: ["Switch to Screen 1", "MoveMouseToCenter"] }, CENTRE_1);

    const window = await kwin.spawnWindow("A");

    const state = await kwin.state();
    const virtual1 = state.outputs.find((o) => o.name === "Virtual-1");
    assert.equal(window.output, "Virtual-1");
    assert.deepEqual(window.desktops, [virtual1.desktop]);
  },
);

test(
  "activating a window and MoveMouseToFocus warp to the window's centre",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await focusAndWarp(kwin, { shortcuts: ["Switch to Screen 1", "MoveMouseToCenter"] }, CENTRE_1);
    await kwin.spawnWindow("A");
    // Off the output's centre, so MoveMouseToCenter would miss it.
    const geometry = { x: 2020, y: 100, width: 400, height: 300 };
    await kwin.runProbe("set-geometry.qml", { caption: "A", geometry });
    const window = await kwin.waitForWindow("A", (w) => w.geometry.x === geometry.x);
    await focusAndWarp(kwin, { shortcuts: ["Switch to Screen 0", "MoveMouseToCenter"] }, CENTRE_0);

    const state = await focusAndWarp(
      kwin,
      { activate: "A", shortcuts: ["MoveMouseToFocus"] },
      centre(window.geometry),
    );

    assert.equal(state.activeScreen, "Virtual-1");
    assert.equal(state.activeWindow, window.id);
  },
);
