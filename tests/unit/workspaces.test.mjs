import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  emptyModel,
  followSwitch,
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

describe("reconcile: windows", () => {
  test("a window away from its workspace goes to where the workspace lives", () => {
    // E.g. "Window to Desktop 2" on A, while workspace 2 lives on B.
    const snapshot = scene({
      shown: { A: 1, B: 3 },
      windows: [
        { id: "w1", desktop: 2, output: "A" },
        { id: "w2", desktop: 2, output: "B" },
      ],
    });

    const { actions } = reconcile(modelWith({ d1: "A", d2: "B", d3: "B" }), snapshot);

    assert.deepEqual(actions, [
      { type: "sendToOutput", window: "w1", output: "B" },
      { type: "adopt", window: "w1", desktop: "d2" },
    ]);
  });

  test("a window on an unused workspace makes it live where the window is", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [{ id: "w1", desktop: 5, output: "A" }],
    });

    const { model, actions } = reconcile(modelWith({ d1: "A", d2: "B" }), snapshot);

    assert.equal(model.location.d5, "A");
    assert.deepEqual(actions, []);
  });

  test("leaves unmanaged windows where they are", () => {
    const snapshot = scene({
      shown: { A: 1, B: 3 },
      windows: [
        { id: "panel", desktop: 2, output: "A", skipTaskbar: true },
        { id: "w2", desktop: 2, output: "B" },
      ],
    });

    const { actions } = reconcile(modelWith({ d1: "A", d2: "B", d3: "B" }), snapshot);

    assert.deepEqual(actions, []);
  });
});

describe("reconcile: dialogs", () => {
  const dialog = (overrides) => ({ transient: true, transientFor: "main", ...overrides });

  test("a dialog gets its main window's workspace", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [
        { id: "main", desktop: 2, output: "B" },
        dialog({ id: "d", desktop: 1, output: "B" }),
      ],
    });

    const { actions } = reconcile(modelWith({ d1: "A", d2: "B" }), snapshot);

    assert.deepEqual(actions, [{ type: "adopt", window: "d", desktop: "d2" }]);
  });

  test("a dialog on another output goes to its main window", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [
        { id: "main", desktop: 2, output: "B" },
        dialog({ id: "d", desktop: 1, output: "A" }),
      ],
    });

    const { actions } = reconcile(modelWith({ d1: "A", d2: "B" }), snapshot);

    assert.deepEqual(actions, [
      { type: "sendToOutput", window: "d", output: "B" },
      { type: "adopt", window: "d", desktop: "d2" },
    ]);
  });

  test("leaves a dialog with its main window alone, and popups always", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [
        { id: "main", desktop: 2, output: "B" },
        dialog({ id: "d", desktop: 2, output: "B" }),
        dialog({ id: "menu", desktop: 1, output: "B", popupWindow: true }),
      ],
    });

    assert.deepEqual(reconcile(modelWith({ d1: "A", d2: "B" }), snapshot).actions, []);
  });

  test("ignores dialogs of unmanaged windows", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [
        { id: "main", desktop: 2, output: "B", skipTaskbar: true },
        dialog({ id: "d", desktop: 1, output: "B" }),
      ],
    });

    assert.deepEqual(reconcile(modelWith({ d1: "A", d2: "B" }), snapshot).actions, []);
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
    const { model } = outputsChanged(beforeUnplug, afterUnplug(), ["A", "B", "C"]);

    assert.deepEqual(model.location, { d1: "A", d2: "A", d3: "A", d4: "C" });
    assert.deepEqual(model.home, { d1: "A", d2: "B", d3: "B", d4: "C" });
  });

  test("gathers their windows there and gives them their workspace back", () => {
    const { actions } = outputsChanged(beforeUnplug, afterUnplug(), ["A", "B", "C"]);

    assert.deepEqual(actions, [send("w3", "A"), adopt("w3", "d3")]);
  });

  test("uses the focused output, whichever it is", () => {
    const { model, actions } = outputsChanged(beforeUnplug, afterUnplug("C"), ["A", "B", "C"]);

    assert.deepEqual(model.location, { d1: "A", d2: "C", d3: "C", d4: "C" });
    assert.deepEqual(actions, [send("w2", "C"), adopt("w2", "d2")]);
  });

  test("falls back to the first output in screen order without a focused one", () => {
    const { model } = outputsChanged(beforeUnplug, afterUnplug(null), ["A", "B", "C"]);

    assert.equal(model.location.d2, "A");
  });

  // B came back: KWin restored w2 there, but not w3, opened while B was away.
  const afterReplug = () =>
    scene({
      shown: { A: 1, B: 2, C: 4 },
      windows: [
        { id: "w1", desktop: 1, output: "A" },
        { id: "w2", desktop: 2, output: "B" },
        { id: "w3", desktop: 3, output: "A" },
        { id: "w4", desktop: 4, output: "C" },
      ],
    });
  const whileUnplugged = {
    location: { d1: "A", d2: "A", d3: "A", d4: "C" },
    home: { d1: "A", d2: "B", d3: "B", d4: "C" },
    previous: {},
  };

  test("brings workspaces back to their returning output, windows and all", () => {
    const { model, actions } = outputsChanged(whileUnplugged, afterReplug(), ["A", "C"]);

    assert.deepEqual(model.location, { d1: "A", d2: "B", d3: "B", d4: "C" });
    assert.deepEqual(model.home, whileUnplugged.home);
    assert.deepEqual(actions, [send("w3", "B"), adopt("w3", "d3")]);
  });

  test("sends back windows KWin restored for a workspace that moved meanwhile", () => {
    const moved = {
      location: { d1: "A", d2: "C", d4: "C" },
      home: { d1: "A", d2: "C", d4: "C" },
      previous: {},
    };

    const { model, actions } = outputsChanged(moved, afterReplug(), ["A", "C"]);

    assert.equal(model.location.d2, "C");
    assert.deepEqual(actions.slice(0, 2), [send("w2", "C"), adopt("w2", "d2")]);
  });

  test("moves nothing to a brand-new output", () => {
    const snapshot = scene({
      shown: { A: 1, N: 5 },
      windows: [{ id: "w1", desktop: 1, output: "A" }],
    });
    const model = modelWith({ d1: "A" });

    assert.deepEqual(outputsChanged(model, snapshot, ["A"]).actions, []);
  });

  test("does not bring back a workspace emptied while its output was away", () => {
    // Workspace 3's last window closed while B was away, so it was forgotten.
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [{ id: "w2", desktop: 2, output: "B" }],
    });
    const model = { location: { d1: "A", d2: "A" }, home: { d1: "A", d2: "B" }, previous: {} };

    const result = outputsChanged(model, snapshot, ["A"]);

    assert.deepEqual(result.model.location, { d1: "A", d2: "B" });
    assert.deepEqual(result.actions, []);
  });

  test("changes nothing when no output went away", () => {
    const snapshot = scene({
      shown: { A: 1, B: 2 },
      windows: [{ id: "w1", desktop: 2, output: "B" }],
    });
    const model = modelWith({ d1: "A", d2: "B" });

    assert.deepEqual(outputsChanged(model, snapshot, ["A", "B"]), { model, actions: [] });
  });
});

describe("followSwitch", () => {
  const show = (desktop, output) => ({ type: "show", desktop, output });
  const focus = (output, warp) => ({ type: "focusOutput", output, warp });
  // Workspace 1 lives on A, 2 (with a window) and 3 on B; A showed 1 before.
  const model = modelWith({ d1: "A", d2: "B", d3: "B" }, { A: "d1" });
  const withWindowOn2 = [{ id: "w2", desktop: 2, output: "B" }];

  test("a switch to a workspace hidden on another output takes you there", () => {
    const snapshot = scene({ shown: { A: 2, B: 3 }, windows: withWindowOn2 });

    assert.deepEqual(followSwitch(model, snapshot, "A", "d2"), [
      show("d1", "A"),
      show("d2", "B"),
      focus("B", "window"),
    ]);
  });

  test("a switch to a workspace shown on another output focuses it there", () => {
    const snapshot = scene({ shown: { A: 2, B: 2 }, windows: withWindowOn2 });

    assert.deepEqual(followSwitch(model, snapshot, "A", "d2"), [
      show("d1", "A"),
      focus("B", "window"),
    ]);
  });

  test("an empty workspace gets the pointer at its output's centre", () => {
    const snapshot = scene({ shown: { A: 2, B: 2 } });

    assert.deepEqual(followSwitch(model, snapshot, "A", "d2"), [
      show("d1", "A"),
      focus("B", "centre"),
    ]);
  });

  test("without a previous workspace the switched output gets a free one", () => {
    const snapshot = scene({ shown: { A: 2, B: 3 }, windows: withWindowOn2 });
    const noPrevious = modelWith({ d2: "B", d3: "B" });

    assert.deepEqual(followSwitch(noPrevious, snapshot, "A", "d2")[0], show("d1", "A"));
  });

  test("needs nothing for an unused workspace or one living on the switched output", () => {
    assert.deepEqual(followSwitch(model, scene({ shown: { A: 5, B: 3 } }), "A", "d5"), []);
    assert.deepEqual(followSwitch(model, scene({ shown: { A: 1, B: 3 } }), "A", "d1"), []);
  });

  test("leaves a switch KWin made to show a window there to reconcile", () => {
    // A dialog of P (workspace 2 on B) opened on B, but with workspace 1 of
    // the focused output A; KWin switched B to workspace 1 to activate it.
    const snapshot = scene({
      shown: { A: 1, B: 1 },
      windows: [
        { id: "P", desktop: 2, output: "B" },
        { id: "dialog", desktop: 1, output: "B", transient: true, transientFor: "P" },
      ],
    });
    const dialogModel = modelWith({ d1: "A", d2: "B" }, { B: "d2" });

    assert.deepEqual(followSwitch(dialogModel, snapshot, "B", "d1"), []);
  });

  test("warns when the switched output has nothing else to show", () => {
    const snapshot = scene({
      shown: { A: 2, B: 2 },
      desktops: 2,
      windows: withWindowOn2,
    });
    const full = modelWith({ d1: "B", d2: "B" });

    assert.deepEqual(
      followSwitch(full, snapshot, "A", "d2").map((a) => a.type),
      ["warn"],
    );
  });
});
