// The model follows windows coming, going and changing workspace (spec §4).

import assert from "node:assert/strict";
import { test } from "node:test";
import { startKwin } from "./harness.mjs";
import { locations } from "./state.mjs";

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
