// Spec 5.2: `Meta+N` shows workspace N on the monitor it lives on, and focus
// and pointer follow to that monitor (spec 6.1).

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

async function waitForCursor(kwin, point) {
  return kwin.waitFor(
    async () => {
      const state = await kwin.state();
      const { x, y } = state.cursor;
      return Math.abs(x - point.x) <= 1 && Math.abs(y - point.y) <= 1 && state;
    },
    { message: `pointer did not reach ${JSON.stringify(point)}` },
  );
}

function centre(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Window A focused on Virtual-0 (workspace 1) with the pointer on it, window B
 * off-centre on Virtual-1 (workspace 2), so the pointer's target is telling.
 */
async function twoWindows(kwin) {
  await kwin.spawnWindow("A");
  await kwin.spawnWindow("B");
  await kwin.act(
    { sendToScreen: { caption: "B", output: "Virtual-1" } },
    { setGeometry: { caption: "B", geometry: { x: 2020, y: 100, width: 400, height: 300 } } },
  );
  const b = await kwin.waitForWindow("B", (w) => w.output === "Virtual-1" && w.geometry.x === 2020);
  await kwin.act({ activate: "A" }, { shortcut: "MoveMouseToFocus" });
  const state = await kwin.waitFor(async () => {
    const s = await kwin.state();
    return s.activeScreen === "Virtual-0" && s.activeWindow !== b.id && s;
  });
  return { a: state.windows.find((w) => w.caption === "A"), b };
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

test(
  "an occupied workspace on the other monitor gets focus, the pointer goes to its window (scenario 1)",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    const { b } = await twoWindows(kwin);

    await switchTo(kwin, 2);

    const state = await waitForCursor(kwin, centre(b.geometry));
    assert.equal(state.activeWindow, b.id);
    assert.equal(state.activeScreen, "Virtual-1");
    assert.deepEqual(shownDesktops(state), { "Virtual-0": 1, "Virtual-1": 2 });
  },
);

test(
  "a workspace hidden on the other monitor is shown there and its window focused",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    const { b } = await twoWindows(kwin);
    await kwin.act({ setDesktops: { caption: "B", desktops: [4] } });
    await kwin.waitFor(async () => locations(await kwin.state())[4] === "Virtual-1");

    await switchTo(kwin, 4);

    const state = await waitForCursor(kwin, centre(b.geometry));
    assert.equal(state.activeWindow, b.id);
    assert.deepEqual(shownDesktops(state), { "Virtual-0": 1, "Virtual-1": 4 });
  },
);

test(
  "an empty workspace on the other monitor gets focus, the pointer goes to its centre (scenarios 3, 4)",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());

    await switchTo(kwin, 2);

    const state = await waitForCursor(kwin, { x: 2880, y: 540 });
    assert.equal(state.activeScreen, "Virtual-1");
    assert.deepEqual(shownDesktops(state), { "Virtual-0": 1, "Virtual-1": 2 });

    const window = await kwin.spawnWindow("New");
    assert.equal(window.output, "Virtual-1", "a new window opens on the focused monitor");
    assert.deepEqual(window.desktops, [state.outputs[1].desktop]);
  },
);

test("switching on the current monitor leaves the pointer alone", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin();
  t.after(() => kwin.stop());
  await kwin.movePointer(-860, -440);
  await waitForCursor(kwin, { x: 100, y: 100 });

  await switchTo(kwin, 3);

  const state = await waitForShown(kwin, { "Virtual-0": 3, "Virtual-1": 2 });
  assert.deepEqual(state.cursor, { x: 100, y: 100 });
});

test(
  "with focus follows mouse, moving the pointer keeps the focused window (scenario 16)",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin({
      config: { kwinrc: { Windows: { FocusPolicy: "FocusFollowsMouse" } } },
    });
    t.after(() => kwin.stop());
    const { b } = await twoWindows(kwin);
    await switchTo(kwin, 2);
    await waitForCursor(kwin, centre(b.geometry));

    await kwin.movePointer(5, 5);
    await sleep(300);

    const state = await kwin.state();
    assert.equal(state.activeWindow, b.id);
    assert.equal(state.activeScreen, "Virtual-1");
  },
);

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
