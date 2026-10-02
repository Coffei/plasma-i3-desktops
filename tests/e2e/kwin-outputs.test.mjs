// KWin behaviour that moving workspaces and hotplug rely on (spec §3, 5.3–5.5).
// These tests use only KWin itself, so they keep checking the assumptions
// after KWin updates.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startKwin } from "./harness.mjs";

function desktopNumbers(state, window) {
  return window.desktops.map((id) => state.desktops.find((d) => d.id === id).number);
}

function shownDesktop(state, outputName) {
  const output = state.outputs.find((o) => o.name === outputName);
  return state.desktops.find((d) => d.id === output.desktop).number;
}

function windowTitled(state, caption) {
  return state.windows.find((w) => w.caption === caption);
}

async function waitForOutputCount(kwin, count) {
  return kwin.waitFor(
    async () => {
      const state = await kwin.state();
      return state.outputs.length === count && state;
    },
    { timeout: 10000, message: `output count did not become ${count}` },
  );
}

test("virtual outputs have no EDID data", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin();
  t.after(() => kwin.stop());

  const state = await kwin.state();

  for (const output of state.outputs) {
    assert.deepEqual([output.manufacturer, output.model, output.serialNumber], ["", "", ""]);
  }
});

test(
  "sendClientToScreen keeps a window's desktop only if the target shows it",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await kwin.act({ showDesktop: { desktop: 2, output: "Virtual-1" } });
    await kwin.spawnWindow("A");

    await kwin.act({ sendToScreen: { caption: "A", output: "Virtual-1" } });
    await kwin.waitForWindow("A", (w) => w.output === "Virtual-1");
    let state = await kwin.state();
    assert.equal(shownDesktop(state, "Virtual-0"), 1);
    assert.deepEqual(
      desktopNumbers(state, windowTitled(state, "A")),
      [2],
      "took the target's desktop",
    );

    await kwin.act(
      { showDesktop: { desktop: 2, output: "Virtual-0" } },
      { sendToScreen: { caption: "A", output: "Virtual-0" } },
    );
    await kwin.waitForWindow("A", (w) => w.output === "Virtual-0");
    state = await kwin.state();
    assert.deepEqual(desktopNumbers(state, windowTitled(state, "A")), [2], "kept its desktop");
  },
);

test(
  "unplug moves windows to the remaining output with their desktops, replug restores them",
  { timeout: 60000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await kwin.act({ showDesktop: { desktop: 2, output: "Virtual-1" } });
    await kwin.spawnWindow("A");
    await kwin.spawnWindow("B");
    await kwin.spawnWindow("C");
    await kwin.act(
      { sendToScreen: { caption: "B", output: "Virtual-1" } },
      { sendToScreen: { caption: "C", output: "Virtual-1" } },
      { setDesktops: { caption: "C", desktops: [3] } },
    );
    await kwin.waitForWindow("C", (w) => w.output === "Virtual-1" && w.desktops.length === 1);
    const before = await kwin.state();
    assert.deepEqual(desktopNumbers(before, windowTitled(before, "C")), [3]);
    await kwin.runProbe("observer.qml");

    await kwin.setOutputEnabled("Virtual-1", false);
    const unplugged = await waitForOutputCount(kwin, 1);

    for (const [caption, desktops] of [
      ["A", [1]],
      ["B", [2]],
      ["C", [3]],
    ]) {
      const window = windowTitled(unplugged, caption);
      assert.equal(window.output, "Virtual-0", `${caption} is on the remaining output`);
      assert.deepEqual(desktopNumbers(unplugged, window), desktops, `${caption} kept its desktop`);
    }
    assert.equal(shownDesktop(unplugged, "Virtual-0"), 1, "the remaining output keeps its desktop");
    const screenChanges = kwin.probeMessages().filter((m) => m.event === "screensChanged");
    t.diagnostic(`screensChanged on unplug: ${screenChanges.length}`);
    assert.ok(screenChanges.length >= 1);

    // Moved while the output is away, but not interactively.
    await kwin.act({
      setGeometry: { caption: "B", geometry: { x: 100, y: 100, width: 400, height: 300 } },
    });
    await kwin.waitForWindow("B", (w) => w.geometry.x === 100);

    await kwin.setOutputEnabled("Virtual-1", true);
    await waitForOutputCount(kwin, 2);
    await kwin.waitForWindow("B", (w) => w.output === "Virtual-1");
    const replugged = await kwin.state();

    for (const caption of ["B", "C"]) {
      const window = windowTitled(replugged, caption);
      assert.equal(window.output, "Virtual-1", `${caption} is back`);
      assert.deepEqual(window.geometry, windowTitled(before, caption).geometry);
    }
    assert.equal(windowTitled(replugged, "A").output, "Virtual-0");
    assert.deepEqual(desktopNumbers(replugged, windowTitled(replugged, "C")), [3]);
    t.diagnostic(`Virtual-1 shows desktop ${shownDesktop(replugged, "Virtual-1")} after replug`);
  },
);

test(
  "unplugging the middle of three outputs splits its windows by nearest output",
  { timeout: 60000 },
  async (t) => {
    const kwin = await startKwin({ outputs: 3 });
    t.after(() => kwin.stop());
    await kwin.spawnWindow("Left");
    await kwin.spawnWindow("Right");
    await kwin.act(
      { sendToScreen: { caption: "Left", output: "Virtual-1" } },
      { sendToScreen: { caption: "Right", output: "Virtual-1" } },
      { setGeometry: { caption: "Left", geometry: { x: 2020, y: 100, width: 400, height: 300 } } },
      { setGeometry: { caption: "Right", geometry: { x: 3340, y: 100, width: 400, height: 300 } } },
    );
    await kwin.waitForWindow("Right", (w) => w.output === "Virtual-1" && w.geometry.x === 3340);

    await kwin.setOutputEnabled("Virtual-1", false);
    const state = await waitForOutputCount(kwin, 2);

    assert.equal(windowTitled(state, "Left").output, "Virtual-0");
    assert.equal(windowTitled(state, "Right").output, "Virtual-2");
  },
);
