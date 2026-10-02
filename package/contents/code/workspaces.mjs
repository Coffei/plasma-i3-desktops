// Where workspaces live, and what to change so that KWin matches (spec §4–§6).
//
// The functions take the model and a snapshot (see snapshot.mjs) and return
// a new model and the actions that bring KWin in line; they never touch KWin.
// The model is plain data:
//   location: desktop id -> key of the output the workspace lives on
//   home:     desktop id -> output key it wants to live on (= location for now)
//   previous: output key  -> desktop id the output showed before its current one
//
// Actions:
//   {type: "show", desktop, output}   show a desktop on an output (by name)
//   {type: "adopt", window, desktop}  move a window to another desktop
//   {type: "sendToOutput", window, output}
//                                     move a window to another output
//   {type: "focusOutput", output, warp}
//                                     focus an output and move the pointer to
//                                     the focused "window" or the output's "centre"
//   {type: "warn", text}              something the user should know about

import { neighbour } from "./outputs.mjs";

export function emptyModel() {
  return { location: {}, home: {}, previous: {} };
}

/**
 * Whether `window` belongs to a workspace for location purposes (spec 5.8).
 *
 * Closed windows linger as deleted ones while their close animation runs.
 */
export function isManaged(window) {
  return (
    !window.deleted &&
    window.normalWindow &&
    !window.transient &&
    !window.specialWindow &&
    !window.desktopWindow &&
    !window.dock &&
    !window.popupWindow &&
    !window.skipTaskbar &&
    !window.onAllDesktops &&
    window.desktops.length === 1
  );
}

/** Remembers that the output keyed `outputKey` showed `previousDesktop` before (spec 6.2). */
export function recordSwitch(model, outputKey, previousDesktop) {
  if (!previousDesktop) {
    return model;
  }
  const previous = Object.assign({}, model.previous, { [outputKey]: previousDesktop });
  return Object.assign({}, model, { previous });
}

/**
 * Restores the invariants of spec §4 after KWin's state changed.
 *
 * Unmapped workspaces are forgotten. A workspace with windows keeps its
 * stored location while that output is connected, otherwise it lives where
 * most of its windows are; an empty, shown workspace lives where it is shown,
 * on the focused output if it is shown on several. Every output showing a
 * workspace that lives elsewhere switches to another one (spec 6.2).
 */
export function reconcile(model, snapshot) {
  const scene = analyse(snapshot);
  const location = {};
  for (const desktop of snapshot.desktops) {
    const key = locate(model, scene, desktop.id);
    if (key) {
      location[desktop.id] = key;
    }
  }

  const actions = [];
  const shown = Object.assign({}, scene.shown);
  for (const output of scene.outputsInOrder) {
    const desktop = shown[output.name];
    if (!desktop || location[desktop] === output.key) {
      continue;
    }
    const replacement = replacementFor(model, snapshot, output, location, shown);
    if (!replacement) {
      actions.push({
        type: "warn",
        text: `no free workspace for ${output.name}, it keeps showing a workspace of another monitor`,
      });
      continue;
    }
    actions.push({ type: "show", desktop: replacement, output: output.name });
    shown[output.name] = replacement;
    location[replacement] = output.key;
  }

  return {
    model: { location, home: Object.assign({}, location), previous: model.previous },
    actions,
  };
}

/**
 * Builds the model from scratch, as at startup (spec 5.1).
 *
 * Like reconcile(), and windows away from their workspace's location adopt
 * the workspace shown on their own output (spec 6.8).
 */
export function rebuild(snapshot) {
  const { model, actions } = reconcile(emptyModel(), snapshot);
  const scene = analyse(snapshot);
  const shown = Object.assign({}, scene.shown);
  for (const action of actions) {
    if (action.type === "show") {
      shown[action.output] = action.desktop;
    }
  }
  for (const window of scene.managed) {
    const desktop = window.desktops[0];
    const shownThere = shown[window.output];
    if (
      model.location[desktop] !== scene.keyOf[window.output] &&
      shownThere &&
      shownThere !== desktop
    ) {
      actions.push({ type: "adopt", window: window.id, desktop: shownThere });
    }
  }
  return { model, actions };
}

/**
 * Plans switching to workspace `number` from the focused output (spec 5.2).
 *
 * A workspace that lives somewhere is shown there; an unmapped one appears
 * on the focused output, and reconcile() then places it there. Focus and
 * pointer follow when that is another output (spec 6.1): to the workspace's
 * window if it has a visible one there, else to the output's centre. Nothing
 * happens if the workspace does not exist or the focused output shows it.
 */
export function switchTo(model, snapshot, number) {
  const desktop = snapshot.desktops[number - 1];
  if (!desktop) {
    return [];
  }
  const scene = analyse(snapshot);
  if (scene.shown[scene.focused] === desktop.id) {
    return [];
  }
  const target = scene.nameOf[model.location[desktop.id]] ?? scene.focused;
  const actions = [];
  if (scene.shown[target] !== desktop.id) {
    actions.push({ type: "show", desktop: desktop.id, output: target });
  }
  if (target !== scene.focused) {
    const visible = scene.managed.some(
      (w) => w.desktops[0] === desktop.id && w.output === target && !w.minimized,
    );
    actions.push({ type: "focusOutput", output: target, warp: visible ? "window" : "centre" });
  }
  return actions;
}

/**
 * Plans moving the focused output's workspace, with its windows, to the
 * neighbouring output in `direction` (spec 5.3).
 *
 * The workspace is shown on the neighbour before its windows move there, so
 * that KWin keeps them on it. The output left behind shows what it showed
 * before if that still lives there, else a free workspace; without one,
 * nothing moves. Focus and pointer go with the workspace.
 */
export function moveWorkspace(model, snapshot, direction) {
  const scene = analyse(snapshot);
  const from = scene.focused;
  const desktop = scene.shown[from];
  const to = desktop ? neighbour(snapshot.outputs, from, direction) : null;
  if (!to) {
    return { model, actions: [] };
  }

  const location = Object.assign({}, model.location, { [desktop]: scene.keyOf[to] });
  const shown = Object.assign({}, scene.shown, { [to]: desktop });
  delete shown[from];
  const hidden = scene.shown[to];
  if (!scene.windowCounts[hidden]) {
    delete location[hidden];
  }
  const replacement = replacementFor(model, snapshot, scene.outputNamed[from], location, shown);
  if (!replacement) {
    return {
      model,
      actions: [{ type: "warn", text: `no free workspace for ${from}, so nothing moves` }],
    };
  }
  location[replacement] = scene.keyOf[from];

  const windows = scene.managed.filter((w) => w.desktops[0] === desktop && w.output === from);
  const actions = [{ type: "show", desktop, output: to }]
    .concat(windows.map((w) => ({ type: "sendToOutput", window: w.id, output: to })))
    .concat([
      { type: "show", desktop: replacement, output: from },
      {
        type: "focusOutput",
        output: to,
        warp: windows.some((w) => !w.minimized) ? "window" : "centre",
      },
    ]);
  return {
    model: Object.assign({}, model, { location, home: Object.assign({}, location) }),
    actions,
  };
}

function locate(model, scene, desktop) {
  const counts = scene.windowCounts[desktop];
  const showing = scene.showing[desktop] ?? [];
  if (!counts && showing.length === 0) {
    return null;
  }
  if (!counts) {
    const keeper = showing.includes(scene.focused) ? scene.focused : showing[0];
    return scene.keyOf[keeper];
  }
  const stored = model.location[desktop];
  if (stored && scene.connectedKeys.has(stored)) {
    return stored;
  }
  return scene.keyOf[majorityOutput(scene, counts, showing)];
}

function majorityOutput(scene, counts, showing) {
  const most = Math.max.apply(null, Object.values(counts));
  const candidates = scene.outputsInOrder
    .map((output) => output.name)
    .filter((name) => counts[name] === most);
  return candidates.find((name) => showing.includes(name)) ?? candidates[0];
}

/**
 * What `output` shows instead of a workspace that lives elsewhere (spec 6.2):
 * its previous workspace if that still lives there, else the lowest-numbered
 * hidden workspace living there, else the lowest-numbered free one.
 */
function replacementFor(model, snapshot, output, location, shown) {
  const shownAnywhere = new Set(Object.values(shown));
  const hiddenHere = (id) => location[id] === output.key && !shownAnywhere.has(id);
  const previous = model.previous[output.key];
  if (previous && hiddenHere(previous)) {
    return previous;
  }
  const own = snapshot.desktops.find((desktop) => hiddenHere(desktop.id));
  const free = snapshot.desktops.find(
    (desktop) => !location[desktop.id] && !shownAnywhere.has(desktop.id),
  );
  return (own ?? free)?.id ?? null;
}

function analyse(snapshot) {
  const order = new Map(snapshot.screenOrder.map((name, index) => [name, index]));
  const outputsInOrder = snapshot.outputs
    .slice()
    .sort((a, b) => (order.get(a.name) ?? Infinity) - (order.get(b.name) ?? Infinity));
  const keyOf = {};
  const nameOf = {};
  const outputNamed = {};
  const shown = {};
  const showing = {};
  // No `??=`: KWin's JavaScript engine is older than that.
  for (const output of outputsInOrder) {
    keyOf[output.name] = output.key;
    nameOf[output.key] = output.name;
    outputNamed[output.name] = output;
    if (output.desktop) {
      shown[output.name] = output.desktop;
      showing[output.desktop] = (showing[output.desktop] ?? []).concat(output.name);
    }
  }
  const managed = snapshot.windows.filter((window) => isManaged(window) && keyOf[window.output]);
  const windowCounts = {};
  for (const window of managed) {
    const desktop = window.desktops[0];
    const counts = windowCounts[desktop] ?? {};
    counts[window.output] = (counts[window.output] ?? 0) + 1;
    windowCounts[desktop] = counts;
  }
  return {
    outputsInOrder,
    keyOf,
    nameOf,
    outputNamed,
    connectedKeys: new Set(Object.values(keyOf)),
    shown,
    showing,
    managed,
    windowCounts,
    focused: snapshot.activeScreen,
  };
}
