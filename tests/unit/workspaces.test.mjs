import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  emptyModel,
  isManaged,
  rebuild,
  reconcile,
  recordSwitch,
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
