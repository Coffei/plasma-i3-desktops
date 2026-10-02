import assert from "node:assert/strict";
import { test } from "node:test";
import { startKwin } from "./harness.mjs";

test("dumps outputs and desktops of the running KWin", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin();
  t.after(() => kwin.stop());

  const state = await kwin.state();

  assert.equal(state.active, true);
  assert.deepEqual(
    state.outputs.map((o) => [o.name, o.geometry]),
    [
      ["Virtual-0", { x: 0, y: 0, width: 1920, height: 1080 }],
      ["Virtual-1", { x: 1920, y: 0, width: 1920, height: 1080 }],
    ],
  );
  assert.deepEqual(
    state.outputs.map((o) => o.key),
    ["Virtual-0", "Virtual-1"],
    "outputs without EDID data are keyed by connector",
  );
  assert.deepEqual(state.screenOrder, ["Virtual-0", "Virtual-1"]);
  assert.equal(state.desktops.length, 10);
  const desktopIds = new Set(state.desktops.map((d) => d.id));
  for (const output of state.outputs) {
    assert.ok(desktopIds.has(output.desktop), `${output.name} shows a known desktop`);
  }
});

test("dumps state while inactive too", { timeout: 30000 }, async (t) => {
  const kwin = await startKwin({ perOutputDesktops: false });
  t.after(() => kwin.stop());

  const state = await kwin.state();

  assert.equal(state.active, false);
  assert.equal(state.outputs.length, 2);
});
