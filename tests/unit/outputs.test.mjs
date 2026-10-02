import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { neighbour, outputKey } from "../../package/contents/code/outputs.mjs";

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

describe("neighbour", () => {
  // Outputs as {name: [x, y, width, height]}.
  function layout(rects) {
    return Object.entries(rects).map(([name, [x, y, width, height]]) => ({
      name,
      geometry: { x, y, width, height },
    }));
  }
  const FHD = [1920, 1080];

  test("finds the output beside, and nothing beyond the outer edges", () => {
    const outputs = layout({ A: [0, 0, ...FHD], B: [1920, 0, ...FHD] });

    assert.equal(neighbour(outputs, "A", "right"), "B");
    assert.equal(neighbour(outputs, "B", "left"), "A");
    assert.equal(neighbour(outputs, "A", "left"), null);
    assert.equal(neighbour(outputs, "B", "right"), null);
    assert.equal(neighbour(outputs, "A", "up"), null);
    assert.equal(neighbour(outputs, "A", "down"), null);
  });

  test("picks the nearest of outputs in a row", () => {
    const outputs = layout({ A: [0, 0, ...FHD], B: [1920, 0, ...FHD], C: [3840, 0, ...FHD] });

    assert.equal(neighbour(outputs, "A", "right"), "B");
    assert.equal(neighbour(outputs, "C", "left"), "B");
  });

  test("finds stacked outputs", () => {
    const outputs = layout({ A: [0, 0, ...FHD], B: [0, 1080, ...FHD] });

    assert.equal(neighbour(outputs, "A", "down"), "B");
    assert.equal(neighbour(outputs, "B", "up"), "A");
    assert.equal(neighbour(outputs, "A", "right"), null);
  });

  test("prefers the output sharing the edge in a grid", () => {
    const outputs = layout({
      TL: [0, 0, ...FHD],
      TR: [1920, 0, ...FHD],
      BL: [0, 1080, ...FHD],
      BR: [1920, 1080, ...FHD],
    });

    assert.equal(neighbour(outputs, "TL", "right"), "TR");
    assert.equal(neighbour(outputs, "TL", "down"), "BL");
    assert.equal(neighbour(outputs, "BR", "up"), "TR");
    assert.equal(neighbour(outputs, "BR", "left"), "BL");
  });

  test("reaches around a corner of an L-shape when nothing shares the edge", () => {
    const outputs = layout({ A: [0, 0, ...FHD], B: [1920, 0, ...FHD], C: [0, 1080, ...FHD] });

    assert.equal(neighbour(outputs, "C", "up"), "A");
    assert.equal(neighbour(outputs, "C", "right"), "B");
  });

  test("copes with outputs of different sizes", () => {
    const outputs = layout({ big: [0, 0, 3840, 2160], small: [3840, 0, ...FHD] });

    assert.equal(neighbour(outputs, "big", "right"), "small");
    assert.equal(neighbour(outputs, "small", "left"), "big");
    // The big output's centre is lower, but it is beside the small one, not below.
    assert.equal(neighbour(outputs, "small", "down"), null);
  });

  test("finds outputs across a gap", () => {
    const outputs = layout({ A: [0, 0, ...FHD], B: [2000, 0, ...FHD] });

    assert.equal(neighbour(outputs, "A", "right"), "B");
  });
});
