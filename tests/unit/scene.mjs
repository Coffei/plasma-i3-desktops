// Builds snapshots (see package/contents/code/snapshot.mjs) for unit tests.

/**
 * `shown` maps output names to the desktop number they show, in screen order.
 * Windows are `{id, desktop, output}` plus any snapshot flags to override;
 * desktops are numbered 1…`desktops` with ids `d1`…; output keys equal names.
 * Outputs are 1920×1080 side by side unless `layout` maps names to
 * `[x, y, width, height]`.
 */
export function scene({ shown, windows = [], active, desktops = 10, layout = {} }) {
  const names = Object.keys(shown);
  return {
    activeScreen: active ?? names[0],
    cursor: { x: 0, y: 0 },
    screenOrder: names,
    outputs: names.map((name, index) => {
      const [x, y, width, height] = layout[name] ?? [index * 1920, 0, 1920, 1080];
      return { name, key: name, geometry: { x, y, width, height }, desktop: `d${shown[name]}` };
    }),
    desktops: Array.from({ length: desktops }, (_, i) => ({
      id: `d${i + 1}`,
      number: i + 1,
      name: `Desktop ${i + 1}`,
    })),
    windows: windows.map(({ desktop, ...rest }) => ({
      output: "A",
      desktops: [`d${desktop}`],
      onAllDesktops: false,
      normalWindow: true,
      dialog: false,
      transient: false,
      specialWindow: false,
      desktopWindow: false,
      dock: false,
      popupWindow: false,
      skipTaskbar: false,
      minimized: false,
      deleted: false,
      ...rest,
    })),
    activeWindow: null,
  };
}

/** Returns `snapshot` as KWin would show it after `actions`. */
export function applyActions(snapshot, actions) {
  const next = structuredClone(snapshot);
  for (const action of actions) {
    if (action.type === "show") {
      next.outputs.find((o) => o.name === action.output).desktop = action.desktop;
    } else if (action.type === "adopt") {
      next.windows.find((w) => w.id === action.window).desktops = [action.desktop];
    }
  }
  return next;
}

/** Output name -> desktop number shown there. */
export function shownNumbers(snapshot) {
  return Object.fromEntries(snapshot.outputs.map((o) => [o.name, Number(o.desktop.slice(1))]));
}
