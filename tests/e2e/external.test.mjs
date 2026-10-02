// Spec 5.6, 5.7, 6.8: what users do through Plasma and KWin rather than the
// script's shortcuts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BTN_LEFT, KEY_LEFTMETA } from "./fakeinput.mjs";
import { startKwin } from "./harness.mjs";
import { desktopNumbers, locations, shownDesktops, windowTitled } from "./state.mjs";
import { centre, waitForCursor, waitForShown } from "./workspaces.mjs";

/**
 * Window A focused on Virtual-0 (workspace 1), B off-centre on Virtual-1
 * (workspace 2), so the pointer's target is telling.
 */
async function twoWindows(kwin) {
  await kwin.spawnWindow("A");
  await kwin.spawnWindow("B");
  await kwin.act(
    { sendToScreen: { caption: "B", output: "Virtual-1" } },
    { setGeometry: { caption: "B", geometry: { x: 2020, y: 100, width: 400, height: 300 } } },
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

test(
  "a dialog opened while focus is on the other monitor appears with its window",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await kwin.spawnWindow("A");
    const parent = await kwin.spawnWindow("P", { dialogAfter: 3000 });
    await kwin.act(
      { sendToScreen: { caption: "P", output: "Virtual-1" } },
      { activate: "A" },
      { shortcut: "MoveMouseToFocus" },
    );
    const before = await kwin.waitFor(async () => {
      const s = await kwin.state();
      return s.activeScreen === "Virtual-0" && s;
    });

    const dialog = await kwin.waitForWindow("P dialog");

    const state = await kwin.waitFor(async () => {
      const s = await kwin.state();
      const d = windowTitled(s, "P dialog");
      return d.output === "Virtual-1" && desktopNumbers(s, d)[0] === 2 && s;
    });
    assert.equal(dialog.transientFor, parent.id);
    assert.deepEqual(shownDesktops(state), { "Virtual-0": 1, "Virtual-1": 2 });
    // KWin switched Virtual-1 to show the dialog; that is no reason to move the pointer.
    assert.deepEqual(state.cursor, before.cursor);
  },
);

/** Waits until a switch made elsewhere took focus and pointer to window B. */
async function waitForFocusOnB(kwin) {
  const b = await kwin.waitForWindow("B");
  const state = await waitForCursor(kwin, centre(b.geometry));
  assert.equal(state.activeWindow, b.id);
  return state;
}

test(
  "a pager switch to a workspace on the other monitor takes you there (scenario 9)",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await twoWindows(kwin);

    // Like Virtual-0's pager asking for workspace 2.
    await kwin.act({ showDesktop: { desktop: 2, output: "Virtual-0" } });

    const state = await waitForFocusOnB(kwin);
    assert.deepEqual(shownDesktops(state), { "Virtual-0": 1, "Virtual-1": 2 });
    assert.deepEqual(locations(state), { 1: "Virtual-0", 2: "Virtual-1" });
  },
);

test(
  "a pager switch to a workspace hidden on the other monitor shows it there",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await twoWindows(kwin);
    // Virtual-1's pager asking for an unused workspace hides workspace 2.
    await kwin.act({ showDesktop: { desktop: 3, output: "Virtual-1" } });
    await waitForShown(kwin, { "Virtual-0": 1, "Virtual-1": 3 });

    await kwin.act({ showDesktop: { desktop: 2, output: "Virtual-0" } });

    const state = await waitForFocusOnB(kwin);
    assert.deepEqual(shownDesktops(state), { "Virtual-0": 1, "Virtual-1": 2 });
  },
);

test(
  "a pager switch to an unused workspace shows it where the pager is (scenario 14)",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    const before = await twoWindows(kwin);

    await kwin.act({ showDesktop: { desktop: 5, output: "Virtual-0" } });

    const state = await kwin.waitFor(async () => {
      const s = await kwin.state();
      return locations(s)[5] === "Virtual-0" && s;
    });
    assert.deepEqual(shownDesktops(state), { "Virtual-0": 5, "Virtual-1": 2 });
    assert.equal(state.activeScreen, "Virtual-0");
    assert.deepEqual(state.cursor, before.cursor);
  },
);

test(
  "KWin's Switch to Desktop ends up like the script's own shortcut (scenario 15)",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await twoWindows(kwin);

    await kwin.invokeShortcut("Switch to Desktop 2");

    const state = await waitForFocusOnB(kwin);
    assert.deepEqual(shownDesktops(state), { "Virtual-0": 1, "Virtual-1": 2 });
  },
);
