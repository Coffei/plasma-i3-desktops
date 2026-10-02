// The model follows windows and switches made outside the script (spec §4, 5.7).

import assert from "node:assert/strict";
import { test } from "node:test";
import { startKwin } from "./harness.mjs";
import { locations, shownDesktops } from "./state.mjs";

async function waitForLocations(kwin, expected) {
  return kwin.waitFor(
    async () => {
      const state = await kwin.state();
      return JSON.stringify(locations(state)) === JSON.stringify(expected) && state;
    },
    { message: `workspaces did not end up at ${JSON.stringify(expected)}` },
  );
}

test(
  "a hidden workspace is forgotten once its last window closes",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await kwin.spawnWindow("A");
    await kwin.act({ setDesktops: { caption: "A", desktops: [3] } });
    await waitForLocations(kwin, { 1: "Virtual-0", 2: "Virtual-1", 3: "Virtual-0" });

    await kwin.closeWindow("A");

    await waitForLocations(kwin, { 1: "Virtual-0", 2: "Virtual-1" });
  },
);

test(
  "a window sent to an unmapped desktop makes it live on the window's output",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await kwin.spawnWindow("A");

    await kwin.act(
      { sendToScreen: { caption: "A", output: "Virtual-1" } },
      { setDesktops: { caption: "A", desktops: [5] } },
    );

    await waitForLocations(kwin, { 1: "Virtual-0", 2: "Virtual-1", 5: "Virtual-1" });
  },
);

test(
  "an output switched elsewhere to a workspace living on another output switches back",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin();
    t.after(() => kwin.stop());
    await kwin.spawnWindow("B");
    await kwin.act({ sendToScreen: { caption: "B", output: "Virtual-1" } });
    await waitForLocations(kwin, { 1: "Virtual-0", 2: "Virtual-1" });

    // Like Virtual-0's pager asking for desktop 2.
    await kwin.act({ showDesktop: { desktop: 2, output: "Virtual-0" } });

    const state = await kwin.waitFor(async () => {
      const s = await kwin.state();
      return s.model.previous["Virtual-0"] && shownDesktops(s)["Virtual-0"] === 1 && s;
    });
    assert.deepEqual(shownDesktops(state), { "Virtual-0": 1, "Virtual-1": 2 });
    assert.deepEqual(locations(state), { 1: "Virtual-0", 2: "Virtual-1" });
  },
);
