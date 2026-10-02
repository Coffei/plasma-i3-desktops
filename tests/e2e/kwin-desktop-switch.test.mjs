// How KWin copes with a script undoing a desktop switch made elsewhere, the
// way spec 5.7 handles pager and Overview clicks. The corrector probe stands
// in for the script, the actions probe for the pager.

import assert from "node:assert/strict";
import { test } from "node:test";
import { sleep, startKwin } from "./harness.mjs";
import { shownDesktop } from "./state.mjs";

/**
 * Virtual-0 shows desktop 1, Virtual-1 shows desktop 2; the corrector and,
 * loaded after it, the observer are running.
 */
async function setUp(kwin, { deferred }) {
  await kwin.act({ showDesktop: { desktop: 2, output: "Virtual-1" } });
  await kwin.runProbe("corrector.qml", { deferred });
  await kwin.waitFor(() => kwin.probeMessages().some((m) => m.probe === "corrector" && m.ready));
  await kwin.runProbe("observer.qml");
  await kwin.waitFor(() => kwin.probeMessages().some((m) => m.event === "ready"));
}

/** Like a pager on Virtual-0 asking for desktop 2, which lives on Virtual-1. */
async function switchFromElsewhere(kwin) {
  await kwin.act({ showDesktop: { desktop: 2, output: "Virtual-0" } });
  return kwin.waitFor(
    async () => {
      if (!kwin.probeMessages().some((m) => m.corrected)) {
        return undefined;
      }
      const state = await kwin.state();
      return (
        shownDesktop(state, "Virtual-0") === 1 && shownDesktop(state, "Virtual-1") === 2 && state
      );
    },
    { message: "switch was not undone" },
  );
}

function observedSwitches(kwin, output) {
  return kwin
    .probeMessages()
    .filter((m) => m.event === "currentDesktopChanged" && m.output === output)
    .map((m) => `${m.previous}->${m.current}`);
}

test(
  "a synchronous correction is seen out of order by scripts connected after it",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin({ script: false });
    t.after(() => kwin.stop());
    await setUp(kwin, { deferred: false });

    await switchFromElsewhere(kwin);

    // The correction's own signal reaches later receivers before the switch
    // it corrects, so the last thing they see is the wrong desktop.
    assert.deepEqual(observedSwitches(kwin, "Virtual-0"), ["2->1", "1->2"]);
  },
);

test(
  "a deferred correction is seen in order by scripts connected after it",
  { timeout: 30000 },
  async (t) => {
    const kwin = await startKwin({ script: false });
    t.after(() => kwin.stop());
    await setUp(kwin, { deferred: true });

    await switchFromElsewhere(kwin);

    assert.deepEqual(observedSwitches(kwin, "Virtual-0"), ["1->2", "2->1"]);
  },
);

for (const deferred of [false, true]) {
  test(
    `a ${deferred ? "deferred" : "synchronous"} correction leaves no effect running`,
    { timeout: 30000 },
    async (t) => {
      const kwin = await startKwin({
        script: false,
        config: { kdeglobals: { KDE: { AnimationDurationFactor: 1 } } },
      });
      t.after(() => kwin.stop());
      await setUp(kwin, { deferred });

      await switchFromElsewhere(kwin);
      await sleep(1500);

      const reply = await kwin.dbus(
        "org.kde.KWin",
        "/Effects",
        "org.freedesktop.DBus.Properties.Get",
        "org.kde.kwin.Effects",
        "activeEffects",
      );
      t.diagnostic(`active effects after the correction: ${reply}`);
      assert.doesNotMatch(reply, /slide/);
      const state = await kwin.state();
      assert.equal(shownDesktop(state, "Virtual-0"), 1);
      assert.equal(shownDesktop(state, "Virtual-1"), 2);
    },
  );
}
