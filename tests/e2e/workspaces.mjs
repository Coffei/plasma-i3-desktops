// Driving the script's workspace shortcuts and waiting for their effect.

import { shownDesktops } from "./state.mjs";

const WHERE = { left: "on the left", right: "on the right", up: "above", down: "below" };

export function switchTo(kwin, number) {
  return kwin.invokeShortcut(`plasma-i3-desktops: Switch to workspace ${number}`);
}

/** `direction` is "left", "right", "up" or "down". */
export function moveWorkspace(kwin, direction) {
  return kwin.invokeShortcut(
    `plasma-i3-desktops: Move workspace to the monitor ${WHERE[direction]}`,
  );
}

/** Waits until the outputs show `expected` (output name -> desktop number). */
export async function waitForShown(kwin, expected) {
  return kwin.waitFor(
    async () => {
      const state = await kwin.state();
      return JSON.stringify(shownDesktops(state)) === JSON.stringify(expected) && state;
    },
    { message: `outputs did not show ${JSON.stringify(expected)}` },
  );
}

export async function waitForCursor(kwin, point) {
  return kwin.waitFor(
    async () => {
      const state = await kwin.state();
      const { x, y } = state.cursor;
      return Math.abs(x - point.x) <= 1 && Math.abs(y - point.y) <= 1 && state;
    },
    { message: `pointer did not reach ${JSON.stringify(point)}` },
  );
}

export function centre(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
