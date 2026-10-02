// Spec 5.3: `Meta+Ctrl+arrow` moves the current workspace, with its windows,
// to the neighbouring monitor (scenario 5).

import assert from "node:assert/strict";
import { test } from "node:test";
import { sleep, startKwin } from "./harness.mjs";
import { desktopNumbers, locations, shownDesktops, windowTitled } from "./state.mjs";
import { centre, moveWorkspace, switchTo, waitForCursor, waitForShown } from "./workspaces.mjs";

function inside(rect, area) {
  return (
    rect.x >= area.x &&
    rect.y >= area.y &&
    rect.x + rect.width <= area.x + area.width &&
    rect.y + rect.height <= area.y + area.height
  );
}

/** Moves, then gives the script time to act, for checks that nothing changed. */
async function moveAndSettle(kwin, direction) {
  await moveWorkspace(kwin, direction);
  await kwin.waitForLog(new RegExp(`move workspace ${direction}`));
  await sleep(200);
}

test(
  "moving right takes the workspace, its windows, focus and pointer along",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await kwin.spawnWindow("M");
    await kwin.spawnWindow("A");
    // Off-centre, so the pointer landing on A differs from the monitor's centre.
    await kwin.act(
      { minimize: "M" },
      { activate: "A" },
      { setGeometry: { caption: "A", geometry: { x: 100, y: 100, width: 400, height: 300 } } },
    );
    await kwin.waitForWindow("A", (w) => w.geometry.x === 100);

    await moveWorkspace(kwin, "right");

    // Workspace 2, which Virtual-1 showed empty, is free again for Virtual-0.
    await waitForShown(kwin, { "Virtual-0": 2, "Virtual-1": 1 });
    const moved = await kwin.waitForWindow("A", (w) => w.output === "Virtual-1");
    assert.notDeepEqual(centre(moved.geometry), { x: 2880, y: 540 });
    const state = await waitForCursor(kwin, centre(moved.geometry));
    const virtual1 = state.outputs.find((o) => o.name === "Virtual-1");
    for (const caption of ["A", "M"]) {
      const window = windowTitled(state, caption);
      assert.equal(window.output, "Virtual-1", `${caption} moved`);
      assert.deepEqual(desktopNumbers(state, window), [1], `${caption} stayed on workspace 1`);
    }
    assert.ok(inside(moved.geometry, virtual1.geometry), "A is inside Virtual-1");
    assert.equal(state.activeWindow, moved.id);
    assert.deepEqual(locations(state), { 1: "Virtual-1", 2: "Virtual-0" });
  },
);

/**
 * Window A focused on Virtual-0 and larger than Virtual-1, which is scaled to
 * 960x540: KWin moves A there only once A has redrawn itself smaller.
 */
async function windowLargerThanVirtual1(kwin) {
  await kwin.setOutputScale("Virtual-1", 2);
  await kwin.waitForOutputsSettled();
  await kwin.spawnWindow("A");
  await kwin.act(
    { activate: "A" },
    { setGeometry: { caption: "A", geometry: { x: 100, y: 100, width: 1200, height: 800 } } },
  );
  await kwin.waitForWindow("A", (w) => w.geometry.width === 1200);
}

test(
  "the pointer follows a window that has to shrink to fit the other monitor",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await windowLargerThanVirtual1(kwin);

    await moveWorkspace(kwin, "right");

    const moved = await kwin.waitForWindow("A", (w) => w.output === "Virtual-1");
    const state = await waitForCursor(kwin, centre(moved.geometry));
    assert.equal(state.activeScreen, "Virtual-1");
    assert.equal(state.activeWindow, moved.id);
  },
);

test(
  "focus moves on when a window is not redrawn in time, the pointer to the centre",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await windowLargerThanVirtual1(kwin);
    kwin.freezeWindow("A", true);

    await moveWorkspace(kwin, "right");

    const state = await waitForCursor(kwin, { x: 2400, y: 270 });
    assert.equal(state.activeScreen, "Virtual-1");
    assert.equal(windowTitled(state, "A").output, "Virtual-0");
    assert.match(kwin.log(), /windows did not arrive on Virtual-1 in time/);
    kwin.freezeWindow("A", false);
  },
);

test("moving towards no monitor does nothing", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin();
  t.after(() => kwin.stop());
  await kwin.spawnWindow("A");

  await moveAndSettle(kwin, "left");

  const state = await kwin.state();
  assert.match(kwin.log(), /move workspace left: nothing to do/);
  assert.deepEqual(shownDesktops(state), { "Virtual-0": 1, "Virtual-1": 2 });
  assert.equal(windowTitled(state, "A").output, "Virtual-0");
});

test(
  "the monitor left behind goes back to the workspace it showed before",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await kwin.spawnWindow("C");
    await kwin.act({ setDesktops: { caption: "C", desktops: [3] } });
    await kwin.waitFor(async () => locations(await kwin.state())[3] === "Virtual-0");
    await switchTo(kwin, 3);
    await waitForShown(kwin, { "Virtual-0": 3, "Virtual-1": 2 });
    await switchTo(kwin, 1);
    await waitForShown(kwin, { "Virtual-0": 1, "Virtual-1": 2 });

    await moveWorkspace(kwin, "right");

    await waitForShown(kwin, { "Virtual-0": 3, "Virtual-1": 1 });
  },
);

test(
  "an empty workspace moves too, with the pointer at the monitor's centre",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());

    await moveWorkspace(kwin, "right");

    await waitForShown(kwin, { "Virtual-0": 2, "Virtual-1": 1 });
    const state = await waitForCursor(kwin, { x: 2880, y: 540 });
    assert.equal(state.activeScreen, "Virtual-1");
  },
);

test("moves up and down between stacked monitors", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin();
  t.after(() => kwin.stop());
  await kwin.setOutputPosition("Virtual-1", 0, 1080);
  await kwin.waitForOutputsSettled();
  await kwin.spawnWindow("A");

  await moveAndSettle(kwin, "right");
  assert.deepEqual(shownDesktops(await kwin.state()), { "Virtual-0": 1, "Virtual-1": 2 });

  await moveWorkspace(kwin, "down");

  await waitForShown(kwin, { "Virtual-0": 2, "Virtual-1": 1 });
  await kwin.waitForWindow("A", (w) => w.output === "Virtual-1");

  await moveWorkspace(kwin, "up");

  await waitForShown(kwin, { "Virtual-0": 1, "Virtual-1": 2 });
  await kwin.waitForWindow("A", (w) => w.output === "Virtual-0");
});
