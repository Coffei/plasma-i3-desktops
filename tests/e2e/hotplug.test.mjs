// Spec 5.4, 5.5 and 6.7: monitors coming and going.

import assert from "node:assert/strict";
import { test } from "node:test";
import { SCRIPT_ID, sleep, startKwin } from "./harness.mjs";
import { locations, shownDesktops } from "./state.mjs";
import { switchTo } from "./workspaces.mjs";

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
