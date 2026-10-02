import assert from "node:assert/strict";
import { test } from "node:test";
import { outputKey } from "../../package/contents/code/outputs.mjs";

function monitor(name, serialNumber, model = "HP U28 4K HDR") {
  return { name, manufacturer: "HP Inc.", model, serialNumber };
}

test("a monitor with a unique serial number is keyed by its EDID data", () => {
  const hp = monitor("DP-2", "1CR2021B9B");
  const other = monitor("DP-3", "1CR2021XXX");

  assert.equal(outputKey(hp, [hp, other]), "HP Inc.|HP U28 4K HDR|1CR2021B9B");
});

test("a monitor without a serial number is keyed by its connector", () => {
  const hp = monitor("DP-2", "");

  assert.equal(outputKey(hp, [hp]), "DP-2");
});

test("identical monitors reporting the same serial number are keyed by their connectors", () => {
  const left = monitor("DP-2", "0");
  const right = monitor("DP-3", "0");

  assert.equal(outputKey(left, [left, right]), "DP-2");
  assert.equal(outputKey(right, [left, right]), "DP-3");
});

test("an output without EDID data is keyed by its connector", () => {
  const virtual = { name: "Virtual-0", manufacturer: "", model: "", serialNumber: "" };

  assert.equal(outputKey(virtual, [virtual]), "Virtual-0");
});
