import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  emptyModel,
  isManaged,
  moveWorkspace,
  outputsChanged,
  rebuild,
  reconcile,
  recordSwitch,
  switchTo,
} from "../../package/contents/code/workspaces.mjs";
import { applyActions, scene, shownNumbers } from "./scene.mjs";

function modelWith(location, previous = {}) {
  return { location, home: { ...location }, previous };
}

/** Reconciles and returns what each output shows afterwards. */
function reconciled(model, snapshot) {
  const result = reconcile(model, snapshot);
  return { ...result, shown: shownNumbers(applyActions(snapshot, result.actions)) };
}

describe("isManaged", () => {
  const [normal] = scene({ shown: { A: 1 }, windows: [{ id: "w", desktop: 1 }] }).windows;

  test("manages normal windows, minimized ones too", () => {
    assert.equal(isManaged(normal), true);
    assert.equal(isManaged({ ...normal, minimized: true }), true);
  });

  for (const [flag, value] of [
    ["normalWindow", false],
    ["transient", true],
    ["specialWindow", true],
    ["desktopWindow", true],
    ["dock", true],
    ["popupWindow", true],
    ["skipTaskbar", true],
    ["onAllDesktops", true],
    ["deleted", true],
  ]) {
    test(`ignores windows with ${flag} ${value}`, () => {
      assert.equal(isManaged({ ...normal, [flag]: value }), false);
    });
  }

  test("ignores windows on several desktops", () => {
    assert.equal(isManaged({ ...normal, desktops: ["d1", "d2"] }), false);
  });
});

describe("reconcile: locations", () => {
  test("locates a workspace where most of its windows are", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [
        { id: "w1", desktop: 3, output: "A" },
        { id: "w2", desktop: 3, output: "B" },
        { id: "w3", desktop: 3, output: "B" },
      ],
    });

    assert.equal(reconcile(emptyModel(), snapshot).model.location.d3, "B");
  });

  test("breaks a tie in favour of the output showing the workspace", () => {
    const snapshot = scene({
      shown: { A: 1, B: 3 },
      windows: [
        { id: "w1", desktop: 3, output: "A" },
        { id: "w2", desktop: 3, output: "B" },
      ],
    });

    assert.equal(reconcile(emptyModel(), snapshot).model.location.d3, "B");
  });

  test("breaks other ties by screen order", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [
        { id: "w1", desktop: 3, output: "B" },
        { id: "w2", desktop: 3, output: "A" },
      ],
    });

    assert.equal(reconcile(emptyModel(), snapshot).model.location.d3, "A");
  });

  test("locates an empty, shown workspace where it is shown", () => {
    const snapshot = scene({ shown: { A: 1, B: 2 } });

    assert.deepEqual(reconcile(emptyModel(), snapshot).model.location, { d1: "A", d2: "B" });
  });

  test("forgets workspaces that are neither occupied nor shown", () => {
    const snapshot = scene({ shown: { A: 1, B: 2 } });

    const { model } = reconcile(modelWith({ d1: "A", d2: "B", d5: "A" }), snapshot);

    assert.deepEqual(model.location, { d1: "A", d2: "B" });
    assert.deepEqual(model.home, { d1: "A", d2: "B" });
  });

  test("keeps a stored location while its output is connected", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [{ id: "w1", desktop: 3, output: "A" }],
    });

    assert.equal(reconcile(modelWith({ d3: "B" }), snapshot).model.location.d3, "B");
  });

  test("relocates a workspace whose output is gone", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [{ id: "w1", desktop: 3, output: "B" }],
    });

    assert.equal(reconcile(modelWith({ d3: "C" }), snapshot).model.location.d3, "B");
  });

  test("ignores unmanaged windows", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [{ id: "w1", desktop: 3, output: "A", dock: true }],
    });

    assert.equal(reconcile(emptyModel(), snapshot).model.location.d3, undefined);
  });
});

describe("reconcile: homes", () => {
  test("keeps the home of a workspace living away from it", () => {
    const snapshot = scene({
      shown: { A: 1 },
      windows: [{ id: "w1", desktop: 2, output: "A" }],
    });
    const model = { location: { d1: "A", d2: "A" }, home: { d1: "A", d2: "B" }, previous: {} };

    assert.deepEqual(reconcile(model, snapshot).model.home, { d1: "A", d2: "B" });
  });

  test("keeps the home when the workspace's output is gone", () => {
    const snapshot = scene({
      shown: { A: 1 },
      windows: [{ id: "w1", desktop: 2, output: "A" }],
    });

    const { model } = reconcile(modelWith({ d1: "A", d2: "B" }), snapshot);

    assert.deepEqual(model.location, { d1: "A", d2: "A" });
    assert.deepEqual(model.home, { d1: "A", d2: "B" });
  });

  test("moves the home with a workspace moving between connected outputs", () => {
    const snapshot = scene({ shown: { A: 1, B: 3 } });

    const { model } = reconcile(modelWith({ d1: "A", d3: "A" }), snapshot);

    assert.equal(model.home.d3, "B");
  });
});

describe("reconcile: outputs showing a workspace of another output", () => {
  test("a workspace shown on two outputs stays where its windows are", () => {
    const snapshot = scene({
      shown: { A: 1, B: 1 },
      windows: [{ id: "w1", desktop: 1, output: "B" }],
    });

    const { model, shown } = reconciled(emptyModel(), snapshot);

    assert.deepEqual(shown, { A: 2, B: 1 });
    assert.deepEqual(model.location, { d1: "B", d2: "A" });
  });

  test("an empty workspace shown on two outputs stays on the focused one", () => {
    const snapshot = scene({ shown: { A: 1, B: 1 }, active: "B" });

    assert.deepEqual(reconciled(emptyModel(), snapshot).shown, { A: 2, B: 1 });
  });

  test("...or on the first output in screen order when neither is focused", () => {
    const snapshot = scene({ shown: { A: 2, B: 1, C: 1 }, active: "A" });

    assert.deepEqual(reconciled(emptyModel(), snapshot).shown, { A: 2, B: 1, C: 3 });
  });

  test("an output showing a workspace whose windows are elsewhere switches away", () => {
    const snapshot = scene({
      shown: { A: 3, B: 2 },
      windows: [{ id: "w1", desktop: 3, output: "B" }],
    });

    const { model, shown } = reconciled(modelWith({ d3: "B" }), snapshot);

    assert.deepEqual(shown, { A: 1, B: 2 });
    assert.equal(model.location.d3, "B");
  });

  test("switches back to the previous workspace when it still lives there", () => {
    const snapshot = scene({
      shown: { A: 3, B: 2 },
      windows: [
        { id: "w1", desktop: 3, output: "B" },
        { id: "w2", desktop: 4, output: "A" },
      ],
    });

    const model = modelWith({ d3: "B", d4: "A" }, { A: "d4" });

    assert.deepEqual(reconciled(model, snapshot).shown, { A: 4, B: 2 });
  });

  test("...not when the previous workspace now lives elsewhere", () => {
    const snapshot = scene({
      shown: { A: 3, B: 2 },
      windows: [
        { id: "w1", desktop: 3, output: "B" },
        { id: "w2", desktop: 4, output: "B" },
      ],
    });

    const model = modelWith({ d3: "B", d4: "B" }, { A: "d4" });

    assert.deepEqual(reconciled(model, snapshot).shown, { A: 1, B: 2 });
  });

  test("...or to the lowest hidden workspace living there before a free one", () => {
    const snapshot = scene({
      shown: { A: 3, B: 2 },
      windows: [
        { id: "w1", desktop: 3, output: "B" },
        { id: "w5", desktop: 5, output: "A" },
        { id: "w6", desktop: 6, output: "A" },
      ],
    });

    const model = modelWith({ d3: "B", d5: "A", d6: "A" });

    assert.deepEqual(reconciled(model, snapshot).shown, { A: 5, B: 2 });
  });

  test("...preferring the previous workspace to a lower one living there", () => {
    const snapshot = scene({
      shown: { A: 3, B: 2 },
      windows: [
        { id: "w1", desktop: 3, output: "B" },
        { id: "w5", desktop: 5, output: "A" },
        { id: "w6", desktop: 6, output: "A" },
      ],
    });

    const model = modelWith({ d3: "B", d5: "A", d6: "A" }, { A: "d6" });

    assert.deepEqual(reconciled(model, snapshot).shown, { A: 6, B: 2 });
  });

  test("outputs switching away never pick the same free workspace", () => {
    const snapshot = scene({ shown: { A: 1, B: 1, C: 1 } });

    const { model, shown } = reconciled(emptyModel(), snapshot);

    assert.deepEqual(shown, { A: 1, B: 2, C: 3 });
    assert.deepEqual(model.location, { d1: "A", d2: "B", d3: "C" });
  });

  test("warns when no free workspace is left", () => {
    const snapshot = scene({ shown: { A: 1, B: 1, C: 2 }, desktops: 2 });

    const { actions } = reconcile(emptyModel(), snapshot);

    assert.deepEqual(
      actions.map((a) => a.type),
      ["warn"],
    );
  });

  test("changes nothing the second time", () => {
    const snapshot = scene({
      shown: { A: 1, B: 1, C: 3 },
      windows: [
        { id: "w1", desktop: 1, output: "B" },
        { id: "w2", desktop: 3, output: "A" },
      ],
    });
    const first = reconcile(emptyModel(), snapshot);

    const second = reconcile(first.model, applyActions(snapshot, first.actions));

    assert.deepEqual(second.actions, []);
    assert.deepEqual(second.model, first.model);
  });
});

describe("rebuild", () => {
  test("windows away from their workspace adopt the workspace shown on their output", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [
        { id: "w1", desktop: 2, output: "B" },
        { id: "w2", desktop: 2, output: "B" },
        { id: "straggler", desktop: 2, output: "A" },
      ],
    });

    const { actions } = rebuild(snapshot);

    assert.deepEqual(actions, [{ type: "adopt", window: "straggler", desktop: "d1" }]);
  });

  test("stragglers adopt what their output shows after collisions are resolved", () => {
    const snapshot = scene({
      shown: { A: 1, B: 1 },
      windows: [
        { id: "w1", desktop: 1, output: "B" },
        { id: "w2", desktop: 1, output: "B" },
        { id: "straggler", desktop: 1, output: "A" },
      ],
    });

    const { actions } = rebuild(snapshot);

    assert.deepEqual(actions, [
      { type: "show", desktop: "d2", output: "A" },
      { type: "adopt", window: "straggler", desktop: "d2" },
    ]);
  });

  test("ignores the previous model", () => {
    const snapshot = scene({ shown: { A: 1, B: 2 } });

    assert.deepEqual(rebuild(snapshot).model, modelWith({ d1: "A", d2: "B" }));
  });
});

describe("recordSwitch", () => {
  test("remembers what an output showed before", () => {
    const model = recordSwitch(emptyModel(), "A", "d3");

    assert.deepEqual(model.previous, { A: "d3" });
  });

  test("keeps the model when there was nothing before", () => {
    const model = recordSwitch(modelWith({}, { A: "d3" }), "A", null);

    assert.deepEqual(model.previous, { A: "d3" });
  });
});

describe("switchTo", () => {
  const show = (desktop, output) => ({ type: "show", desktop, output });
  const focus = (output, warp) => ({ type: "focusOutput", output, warp });

  test("shows an unmapped workspace on the focused output", () => {
    const snapshot = scene({ shown: { A: 1, B: 2 }, active: "B" });

    assert.deepEqual(switchTo(modelWith({ d1: "A", d2: "B" }), snapshot, 3), [show("d3", "B")]);
  });

  test("shows a workspace hidden on another output there and focuses its window", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [{ id: "w1", desktop: 4, output: "B" }],
    });

    const model = modelWith({ d1: "A", d2: "B", d4: "B" });

    assert.deepEqual(switchTo(model, snapshot, 4), [show("d4", "B"), focus("B", "window")]);
  });

  test("focuses the centre of another output showing the empty workspace", () => {
    const snapshot = scene({ shown: { A: 1, B: 2 } });

    assert.deepEqual(switchTo(modelWith({ d1: "A", d2: "B" }), snapshot, 2), [
      focus("B", "centre"),
    ]);
  });

  test("focuses the centre when the workspace's only windows there are minimized", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [{ id: "w1", desktop: 2, output: "B", minimized: true }],
    });

    assert.deepEqual(switchTo(modelWith({ d1: "A", d2: "B" }), snapshot, 2), [
      focus("B", "centre"),
    ]);
  });

  test("does nothing for the workspace the focused output shows", () => {
    const snapshot = scene({ shown: { A: 1, B: 2 } });

    assert.deepEqual(switchTo(modelWith({ d1: "A", d2: "B" }), snapshot, 1), []);
  });

  test("does nothing for a workspace beyond the last desktop", () => {
    const snapshot = scene({ shown: { A: 1, B: 2 }, desktops: 5 });

    assert.deepEqual(switchTo(modelWith({ d1: "A", d2: "B" }), snapshot, 7), []);
  });

  test("treats a workspace living on a disconnected output as unmapped", () => {
    const snapshot = scene({ shown: { A: 1, B: 2 } });

    const model = modelWith({ d1: "A", d2: "B", d3: "C" });

    assert.deepEqual(switchTo(model, snapshot, 3), [show("d3", "A")]);
  });
});

describe("moveWorkspace", () => {
  const show = (desktop, output) => ({ type: "show", desktop, output });
  const send = (window, output) => ({ type: "sendToOutput", window, output });
  const focus = (output, warp) => ({ type: "focusOutput", output, warp });

  test("moves the workspace and its windows to the neighbour, and focus with them", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [
        { id: "w1", desktop: 1, output: "A" },
        { id: "w2", desktop: 1, output: "A", minimized: true },
        { id: "w3", desktop: 2, output: "B" },
      ],
    });

    const { model, actions } = moveWorkspace(modelWith({ d1: "A", d2: "B" }), snapshot, "right");

    assert.deepEqual(actions, [
      show("d1", "B"),
      send("w1", "B"),
      send("w2", "B"),
      show("d3", "A"),
      focus("B", "window"),
    ]);
    assert.deepEqual(model.location, { d1: "B", d2: "B", d3: "A" });
    assert.deepEqual(model.home, model.location);
  });

  test("the output left behind shows its previous workspace if it still lives there", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [
        { id: "w1", desktop: 1, output: "A" },
        { id: "w4", desktop: 4, output: "A" },
      ],
    });

    const model = modelWith({ d1: "A", d2: "B", d4: "A" }, { A: "d4" });

    const { actions } = moveWorkspace(model, snapshot, "right");

    assert.deepEqual(actions.at(-2), show("d4", "A"));
  });

  test("the output left behind shows a hidden workspace of its own before a free one", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [
        { id: "w1", desktop: 1, output: "A" },
        { id: "w4", desktop: 4, output: "A" },
      ],
    });

    const model = modelWith({ d1: "A", d2: "B", d4: "A" });

    const { actions } = moveWorkspace(model, snapshot, "right");

    assert.deepEqual(actions.at(-2), show("d4", "A"));
  });

  test("an empty workspace the neighbour hid becomes free for the output left behind", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [{ id: "w1", desktop: 1, output: "A" }],
    });

    const { model, actions } = moveWorkspace(modelWith({ d1: "A", d2: "B" }), snapshot, "right");

    assert.deepEqual(actions.at(-2), show("d2", "A"));
    assert.deepEqual(model.location, { d1: "B", d2: "A" });
  });

  test("moves an empty workspace, focusing the neighbour's centre", () => {
    const snapshot = scene({ shown: { A: 1, B: 2 } });

    const { actions } = moveWorkspace(modelWith({ d1: "A", d2: "B" }), snapshot, "right");

    assert.deepEqual(actions, [show("d1", "B"), show("d2", "A"), focus("B", "centre")]);
  });

  test("leaves unmanaged windows where they are", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [{ id: "panel", desktop: 1, output: "A", dock: true }],
    });

    const { actions } = moveWorkspace(modelWith({ d1: "A", d2: "B" }), snapshot, "right");

    assert.equal(
      actions.some((a) => a.type === "sendToOutput"),
      false,
    );
  });

  test("does nothing without a neighbour in that direction", () => {
    const snapshot = scene({ shown: { A: 1, B: 2 } });
    const model = modelWith({ d1: "A", d2: "B" });

    for (const direction of ["left", "up", "down"]) {
      assert.deepEqual(moveWorkspace(model, snapshot, direction), { model, actions: [] });
    }
  });

  test("keeps the homes of other workspaces", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [{ id: "w5", desktop: 5, output: "A" }],
    });
    const model = {
      location: { d1: "A", d2: "B", d5: "A" },
      home: { d1: "A", d2: "B", d5: "C" },
      previous: {},
    };

    assert.equal(moveWorkspace(model, snapshot, "right").model.home.d5, "C");
  });

  test("moves down to an output below", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      layout: { A: [0, 0, 1920, 1080], B: [0, 1080, 1920, 1080] },
    });

    const { actions } = moveWorkspace(modelWith({ d1: "A", d2: "B" }), snapshot, "down");

    assert.deepEqual(actions[0], show("d1", "B"));
  });

  test("moves nothing when the output left behind would have nothing to show", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      desktops: 2,
      windows: [
        { id: "w1", desktop: 1, output: "A" },
        { id: "w2", desktop: 2, output: "B" },
      ],
    });
    const model = modelWith({ d1: "A", d2: "B" });

    const result = moveWorkspace(model, snapshot, "right");

    assert.equal(result.model, model);
    assert.deepEqual(
      result.actions.map((a) => a.type),
      ["warn"],
    );
  });
});

describe("outputsChanged", () => {
  const send = (window, output) => ({ type: "sendToOutput", window, output });
  const adopt = (window, desktop) => ({ type: "adopt", window, desktop });
  // B was unplugged: its workspaces 2 and 3 lived there, KWin put their
  // windows on the nearest outputs.
  const afterUnplug = (active = "A") =>
    scene({
      shown: { A: 1, C: 4 },
      active,
      windows: [
        { id: "w1", desktop: 1, output: "A" },
        { id: "w2", desktop: 2, output: "A" },
        { id: "w3", desktop: 3, output: "C" },
        { id: "w4", desktop: 4, output: "C" },
      ],
    });
  const beforeUnplug = modelWith({ d1: "A", d2: "B", d3: "B", d4: "C" });

  test("moves a removed output's workspaces to the focused one, keeping their home", () => {
    const { model } = outputsChanged(beforeUnplug, afterUnplug());

    assert.deepEqual(model.location, { d1: "A", d2: "A", d3: "A", d4: "C" });
    assert.deepEqual(model.home, { d1: "A", d2: "B", d3: "B", d4: "C" });
  });

  test("gathers their windows there and gives them their workspace back", () => {
    const { actions } = outputsChanged(beforeUnplug, afterUnplug());

    assert.deepEqual(actions, [send("w3", "A"), adopt("w3", "d3")]);
  });

  test("uses the focused output, whichever it is", () => {
    const { model, actions } = outputsChanged(beforeUnplug, afterUnplug("C"));

    assert.deepEqual(model.location, { d1: "A", d2: "C", d3: "C", d4: "C" });
    assert.deepEqual(actions, [send("w2", "C"), adopt("w2", "d2")]);
  });

  test("falls back to the first output in screen order without a focused one", () => {
    const { model } = outputsChanged(beforeUnplug, afterUnplug(null));

    assert.equal(model.location.d2, "A");
  });

  test("changes nothing when no output went away", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [{ id: "w1", desktop: 2, output: "B" }],
    });
    const model = modelWith({ d1: "A", d2: "B" });

    assert.deepEqual(outputsChanged(model, snapshot), { model, actions: [] });
  });
});
