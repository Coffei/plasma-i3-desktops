// Reading the state dump (see harness.mjs state()) by desktop number and caption.

/** The number of the desktop `outputName` shows. */
export function shownDesktop(state, outputName) {
  const output = state.outputs.find((o) => o.name === outputName);
  return desktopNumber(state, output.desktop);
}

/** Output name -> number of the desktop it shows. */
export function shownDesktops(state) {
  return Object.fromEntries(state.outputs.map((o) => [o.name, desktopNumber(state, o.desktop)]));
}

/** The numbers of the desktops `window` is on. */
export function desktopNumbers(state, window) {
  return window.desktops.map((id) => desktopNumber(state, id));
}

export function windowTitled(state, caption) {
  return state.windows.find((w) => w.caption === caption);
}

/** Where the script's workspaces live, as desktop number -> output key. */
export function locations(state) {
  return byNumber(state, state.model.location);
}

/** Where the script's workspaces want to live, as desktop number -> output key. */
export function homes(state) {
  return byNumber(state, state.model.home);
}

function byNumber(state, map) {
  return Object.fromEntries(
    Object.entries(map)
      .map(([id, key]) => [desktopNumber(state, id), key])
      .sort(([a], [b]) => a - b),
  );
}

function desktopNumber(state, id) {
  return state.desktops.find((d) => d.id === id).number;
}
