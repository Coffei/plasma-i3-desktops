import assert from "node:assert/strict";
import { test } from "node:test";
import { snapshot } from "../../package/contents/code/snapshot.mjs";

function fakeWorkspace() {
  const desktops = [1, 2, 3].map((n) => ({ id: `d${n}`, name: `Desktop ${n}` }));
  const left = {
    name: "DP-1",
    manufacturer: "HP Inc.",
    model: "HP U28 4K HDR",
    serialNumber: "1CR2021B9B",
    geometry: { x: 0, y: 0, width: 1920, height: 1080 },
  };
  const right = {
    ...left,
    name: "DP-2",
    serialNumber: "1CR2021XXX",
    geometry: { x: 1920, y: 0, width: 1920, height: 1080 },
  };
  const editor = {
    internalId: "{w1}",
    caption: "notes.txt — Kate",
    resourceClass: "org.kde.kate",
    output: right,
    desktops: [desktops[1]],
    onAllDesktops: false,
    frameGeometry: { x: 2000, y: 100, width: 800, height: 600 },
    normalWindow: true,
    dialog: false,
    transient: false,
    specialWindow: false,
    desktopWindow: false,
    dock: false,
    popupWindow: false,
    skipTaskbar: false,
    minimized: false,
  };
  const shown = new Map([
    [left, desktops[0]],
    [right, desktops[1]],
  ]);
  return {
    activeScreen: right,
    cursorPos: { x: 2400, y: 400 },
    screens: [left, right],
    screenOrder: [right, left],
    desktops,
    stackingOrder: [editor],
    activeWindow: editor,
    currentDesktopForScreen: (output) => shown.get(output),
  };
}

test("captures outputs with their keys and what they show", () => {
  const state = snapshot(fakeWorkspace());

  assert.deepEqual(state.outputs[1], {
    name: "DP-2",
    key: "HP Inc.|HP U28 4K HDR|1CR2021XXX",
    manufacturer: "HP Inc.",
    model: "HP U28 4K HDR",
    serialNumber: "1CR2021XXX",
    geometry: { x: 1920, y: 0, width: 1920, height: 1080 },
    desktop: "d2",
  });
  assert.deepEqual(state.screenOrder, ["DP-2", "DP-1"]);
  assert.equal(state.activeScreen, "DP-2");
  assert.deepEqual(state.cursor, { x: 2400, y: 400 });
});

test("numbers desktops from 1", () => {
  const state = snapshot(fakeWorkspace());

  assert.deepEqual(
    state.desktops.map((d) => [d.id, d.number]),
    [
      ["d1", 1],
      ["d2", 2],
      ["d3", 3],
    ],
  );
});

test("captures windows by id, output and desktops", () => {
  const state = snapshot(fakeWorkspace());

  assert.equal(state.windows.length, 1);
  assert.equal(state.activeWindow, "{w1}");
  const [window] = state.windows;
  assert.equal(window.id, "{w1}");
  assert.equal(window.output, "DP-2");
  assert.deepEqual(window.desktops, ["d2"]);
  assert.deepEqual(window.geometry, { x: 2000, y: 100, width: 800, height: 600 });
  assert.equal(window.normalWindow, true);
});

test("leaves out window titles unless asked for", () => {
  const [hidden] = snapshot(fakeWorkspace()).windows;
  const [shown] = snapshot(fakeWorkspace(), { includeTitles: true }).windows;

  assert.equal("caption" in hidden, false);
  assert.equal("resourceClass" in hidden, false);
  assert.equal(shown.caption, "notes.txt — Kate");
  assert.equal(shown.resourceClass, "org.kde.kate");
});

test("copes with array-like lists and a missing active window", () => {
  const workspace = fakeWorkspace();
  workspace.stackingOrder = { length: 0 };
  workspace.activeWindow = null;
  workspace.activeScreen = null;

  const state = snapshot(workspace);

  assert.deepEqual(state.windows, []);
  assert.equal(state.activeWindow, null);
  assert.equal(state.activeScreen, null);
});
