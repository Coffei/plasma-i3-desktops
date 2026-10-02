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
