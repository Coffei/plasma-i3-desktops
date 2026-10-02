// Identity of outputs (monitors) across unplug and replug.

/**
 * Returns a key that identifies `output` among `connectedOutputs`.
 *
 * Connector names (`DP-2`) change when a monitor moves to another port or
 * dock, so a monitor is identified by its EDID data where that is unique:
 * `manufacturer|model|serialNumber`. Monitors without a serial number, or
 * identical ones reporting the same serial, fall back to the connector name.
 */
export function outputKey(output, connectedOutputs) {
  const key = edidKey(output);
  if (key && connectedOutputs.filter((other) => edidKey(other) === key).length === 1) {
    return key;
  }
  return output.name;
}

function edidKey(output) {
  return output.serialNumber
    ? [output.manufacturer, output.model, output.serialNumber].join("|")
    : null;
}

const DIRECTIONS = {
  left: { axis: "x", sign: -1 },
  right: { axis: "x", sign: 1 },
  up: { axis: "y", sign: -1 },
  down: { axis: "y", sign: 1 },
};

/**
 * Finds the output next to the one named `fromName` in `direction` (spec 6.5).
 *
 * `direction` is "left", "right", "up" or "down". Candidates are outputs whose
 * centre lies beyond that edge of the output; the one sharing the longest
 * stretch of that edge wins, then the nearest. There is no wrap-around:
 * without a candidate the result is null.
 */
export function neighbour(outputs, fromName, direction) {
  const from = outputs.find((output) => output.name === fromName);
  const { axis, sign } = DIRECTIONS[direction];
  const edge = sign > 0 ? end(from.geometry, axis) : from.geometry[axis];
  const origin = centre(from.geometry);
  const across = axis === "x" ? "y" : "x";
  const candidates = outputs
    .filter((output) => sign * (centre(output.geometry)[axis] - edge) > 0)
    .map((output) => ({
      name: output.name,
      overlap: overlap(from.geometry, output.geometry, across),
      distance: Math.hypot(...["x", "y"].map((a) => centre(output.geometry)[a] - origin[a])),
    }))
    .sort((a, b) => b.overlap - a.overlap || a.distance - b.distance);
  return candidates.length ? candidates[0].name : null;
}

function centre(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function end(rect, axis) {
  return axis === "x" ? rect.x + rect.width : rect.y + rect.height;
}

function overlap(a, b, axis) {
  return Math.max(0, Math.min(end(a, axis), end(b, axis)) - Math.max(a[axis], b[axis]));
}
