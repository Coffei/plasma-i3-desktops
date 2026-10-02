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

/** The script's model as desktop number -> output key. */
export function locations(state) {
  return Object.fromEntries(
    Object.entries(state.model.location)
      .map(([id, key]) => [desktopNumber(state, id), key])
      .sort(([a], [b]) => a - b),
  );
}

function desktopNumber(state, id) {
  return state.desktops.find((d) => d.id === id).number;
}
