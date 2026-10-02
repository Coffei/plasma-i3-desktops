// Converts KWin's live objects into plain data.
//
// The snapshot is what the script dumps for debugging and tests, and what its
// decision logic will work on. It only reads properties, so tests can pass
// plain objects in place of KWin's.

import { outputKey } from "./outputs.mjs";

/**
 * Captures outputs, desktops and windows of a KWin `workspace`.
 *
 * Window titles and classes are included only with `includeTitles`, so that
 * nothing personal reaches the journal unless debugging is on. Windows are
 * listed bottom to top.
 */
export function snapshot(workspace, { includeTitles = false } = {}) {
  const screens = list(workspace.screens);
  return {
    activeScreen: workspace.activeScreen?.name ?? null,
    cursor: point(workspace.cursorPos),
    screenOrder: list(workspace.screenOrder).map((output) => output.name),
    outputs: screens.map((output) => outputData(workspace, output, screens)),
    desktops: list(workspace.desktops).map((desktop, index) => ({
      id: desktop.id,
      number: index + 1,
      name: desktop.name,
    })),
    windows: list(workspace.stackingOrder).map((window) => windowData(window, includeTitles)),
    activeWindow: workspace.activeWindow ? windowId(workspace.activeWindow) : null,
  };
}

function outputData(workspace, output, screens) {
  return {
    name: output.name,
    key: outputKey(output, screens),
    manufacturer: output.manufacturer,
    model: output.model,
    serialNumber: output.serialNumber,
    geometry: rect(output.geometry),
    desktop: workspace.currentDesktopForScreen(output)?.id ?? null,
  };
}

function windowData(window, includeTitles) {
  // No object spread: KWin's JavaScript engine does not support it.
  const titles = includeTitles
    ? { caption: window.caption, resourceClass: window.resourceClass }
    : {};
  return Object.assign({ id: windowId(window) }, titles, {
    output: window.output?.name ?? null,
    desktops: list(window.desktops).map((desktop) => desktop.id),
    onAllDesktops: window.onAllDesktops,
    geometry: rect(window.frameGeometry),
    normalWindow: window.normalWindow,
    dialog: window.dialog,
    transient: window.transient,
    specialWindow: window.specialWindow,
    desktopWindow: window.desktopWindow,
    dock: window.dock,
    popupWindow: window.popupWindow,
    skipTaskbar: window.skipTaskbar,
    minimized: window.minimized,
  });
}

function windowId(window) {
  return String(window.internalId);
}

// QML hands lists over as array-likes, not always as real arrays.
function list(items) {
  return Array.from(items ?? []);
}

function point(p) {
  return p ? { x: p.x, y: p.y } : null;
}

function rect(r) {
  return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
}
