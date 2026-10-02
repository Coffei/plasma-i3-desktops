// Where workspaces live, and what to change so that KWin matches (spec §4–§6).
//
// The functions take the model and a snapshot (see snapshot.mjs) and return
// a new model and the actions that bring KWin in line; they never touch KWin.
// The model is plain data:
//   location: desktop id -> key of the output the workspace lives on
//   home:     desktop id -> output key it wants to live on; differs from
//             location only while its own output is unplugged (spec 5.4)
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
 * workspace that lives elsewhere switches to another one (spec 6.2), and
 * windows on another output than their workspace go there (spec 5.6, 5.7),
 * e.g. after "Window to Desktop N".
 */
export function reconcile(model, snapshot) {
  const result = place(model, snapshot);
  const gathered = gather(result.model.location, analyse(snapshot));
  return { model: result.model, actions: result.actions.concat(gathered) };
}

function place(model, snapshot) {
  const scene = analyse(snapshot);
  const location = {};
  const home = {};
  for (const desktop of snapshot.desktops) {
    const key = locate(model, scene, desktop.id);
    if (key) {
      location[desktop.id] = key;
      home[desktop.id] = homeOf(model, scene, desktop.id, key);
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
    home[replacement] = home[replacement] ?? output.key;
  }

  return { model: { location, home, previous: model.previous }, actions };
}

/**
 * Brings the model in line with outputs that came or went (spec 5.4, 5.5).
 *
 * `knownKeys` are the keys of the outputs the model was last in line with.
 * Workspaces of a removed output move to the focused output, or the first in
 * screen order, and keep the removed one as their home; workspaces whose home
 * came back move there again. Every window then goes to where its workspace
 * lives: KWin spreads the windows of a removed output over the nearest ones
 * and puts them back when it returns, also windows whose workspace has moved
 * meanwhile. It replaces the desktop of a window it moves to an output not
 * showing it, so the desktop is set again.
 */
export function outputsChanged(model, snapshot, knownKeys) {
  const scene = analyse(snapshot);
  const fallback = scene.keyOf[scene.focused] ?? scene.outputsInOrder[0]?.key;
  if (!fallback) {
    return { model, actions: [] };
  }
  const added = new Set(Array.from(scene.connectedKeys).filter((key) => !knownKeys.includes(key)));
  const location = Object.assign({}, model.location);
  for (const desktop of Object.keys(location)) {
    if (added.has(model.home[desktop])) {
      location[desktop] = model.home[desktop];
    } else if (!scene.connectedKeys.has(location[desktop])) {
      location[desktop] = fallback;
    }
  }

  return { model: Object.assign({}, model, { location }), actions: gather(location, scene) };
}

/**
 * Sends windows on another output than their workspace's location there, and
 * dialogs to their main window's output and workspace (spec 5.6).
 *
 * KWin gives a new dialog the desktop of the focused output, even when it
 * opens next to its main window on another one, where it would be hidden.
 * KWin replaces the desktop of a window it moves to an output not showing
 * it, so the desktop is set again.
 */
function gather(location, scene) {
  const actions = [];
  for (const window of scene.managed) {
    const desktop = window.desktops[0];
    const target = scene.nameOf[location[desktop]];
    if (target && target !== window.output) {
      actions.push(
        { type: "sendToOutput", window: window.id, output: target },
        { type: "adopt", window: window.id, desktop },
      );
    }
  }
  for (const dialog of scene.dialogs) {
    const main = scene.managed.find((window) => window.id === dialog.transientFor);
    if (!main) {
      continue;
    }
    const target = scene.nameOf[location[main.desktops[0]]] ?? main.output;
    const desktop = main.desktops[0];
    if (dialog.output !== target) {
      actions.push({ type: "sendToOutput", window: dialog.id, output: target });
    }
    if (dialog.output !== target || dialog.desktops[0] !== desktop) {
      actions.push({ type: "adopt", window: dialog.id, desktop });
    }
  }
  return actions;
}

/**
 * Builds the model from scratch, as at startup (spec 5.1).
 *
 * Like reconcile(), except that windows away from their workspace's location
 * adopt the workspace shown on their own output instead (spec 6.8).
 */
export function rebuild(snapshot) {
  const { model, actions } = place(emptyModel(), snapshot);
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
 * Plans what follows when something else, e.g. a pager or the Overview,
 * switched output `outputName` to `desktop` (spec 5.7).
 *
 * A switch to a workspace living on another output is taken as asking to go
 * there, as with switchTo(): the switched output shows another workspace
 * again, normally its previous one (spec 6.2), the workspace is shown where
 * it lives, and focus and pointer go there. Other switches need nothing
 * beyond reconcile(). That includes KWin switching an output to show a window
 * it activates there, e.g. a new dialog on the wrong desktop: reconcile()
 * then fixes the window rather than taking focus elsewhere.
 */
export function followSwitch(model, snapshot, outputName, desktop) {
  const scene = analyse(snapshot);
  const target = scene.nameOf[model.location[desktop]];
  if (!target || target === outputName || scene.shown[outputName] !== desktop) {
    return [];
  }
  const showsWindowThere = scene.managed
    .concat(scene.dialogs)
    .some((w) => w.output === outputName && w.desktops[0] === desktop);
  if (showsWindowThere) {
    return [];
  }
  const shown = Object.assign({}, scene.shown, { [target]: desktop });
  delete shown[outputName];
  const output = scene.outputNamed[outputName];
  const replacement = replacementFor(model, snapshot, output, model.location, shown);
  if (!replacement) {
    return [{ type: "warn", text: `no free workspace for ${outputName}, so it stays switched` }];
  }
  const actions = [{ type: "show", desktop: replacement, output: outputName }];
  if (scene.shown[target] !== desktop) {
    actions.push({ type: "show", desktop, output: target });
  }
  const visible = scene.managed.some(
    (w) => w.desktops[0] === desktop && w.output === target && !w.minimized,
  );
  actions.push({ type: "focusOutput", output: target, warp: visible ? "window" : "centre" });
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
  const home = Object.assign({}, model.home, { [desktop]: scene.keyOf[to] });
  const shown = Object.assign({}, scene.shown, { [to]: desktop });
  delete shown[from];
  const hidden = scene.shown[to];
  if (!scene.windowCounts[hidden]) {
    delete location[hidden];
    delete home[hidden];
  }
  const replacement = replacementFor(model, snapshot, scene.outputNamed[from], location, shown);
  if (!replacement) {
    return {
      model,
      actions: [{ type: "warn", text: `no free workspace for ${from}, so nothing moves` }],
    };
  }
  location[replacement] = scene.keyOf[from];
  home[replacement] = home[replacement] ?? scene.keyOf[from];

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
  return { model: Object.assign({}, model, { location, home }), actions };
}

/**
 * A workspace keeps its home while it stays where it is, or when its stored
 * output is gone; moving between connected outputs moves its home too.
 */
function homeOf(model, scene, desktop, key) {
  const stored = model.location[desktop];
  const keep =
    model.home[desktop] && stored && (stored === key || !scene.connectedKeys.has(stored));
  return keep ? model.home[desktop] : key;
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
  // Dialogs and other transient windows, but not menus and other popups.
  const dialogs = snapshot.windows.filter(
    (window) =>
      window.transientFor &&
      !window.popupWindow &&
      !window.deleted &&
      !window.onAllDesktops &&
      window.desktops.length === 1,
  );
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
    dialogs,
    windowCounts,
    focused: snapshot.activeScreen,
  };
}
