import test from "node:test";
import assert from "node:assert/strict";
import { Mog2 } from "../lib/cctv/mog2.ts";

const W = 64;
const H = 48;

const blank = () => Buffer.alloc(W * H, 0);

function withBlock(x0 = 20, y0 = 16, size = 16) {
  const frame = blank();
  for (let y = y0; y < y0 + size; y += 1) {
    for (let x = x0; x < x0 + size; x += 1) frame[y * W + x] = 255;
  }
  return frame;
}

test("a static scene never reports motion", () => {
  const model = new Mog2(W, H, { warmup: 5 });
  let result;

  for (let i = 0; i < 15; i += 1) result = model.apply(blank());

  assert.equal(result.ready, true);
  assert.equal(result.changedPixels, 0);
  assert.equal(result.ratio, 0);
});

test("the first frame only trains the model", () => {
  const model = new Mog2(W, H);
  const result = model.apply(blank());
  assert.equal(result.frames, 1);
  assert.equal(result.ready, false);
  assert.equal(result.ratio, 0);
});

test("an object entering the scene is detected as foreground", () => {
  const model = new Mog2(W, H, { warmup: 5, erode: true });
  for (let i = 0; i < 10; i += 1) model.apply(blank());

  const result = model.apply(withBlock());
  assert.equal(result.ready, true);
  assert.ok(result.changedPixels > 100, `expected a foreground blob, got ${result.changedPixels}`);
  assert.ok(result.ratio > 0.02, `ratio too small: ${result.ratio}`);
  assert.ok(result.foreground.some((value) => value === 1));
});

test("erosion removes isolated noise", () => {
  const noisy = blank();
  noisy[5 * W + 5] = 255; // single pixel
  noisy[6 * W + 6] = 255;

  const model = new Mog2(W, H, { warmup: 3 });
  for (let i = 0; i < 6; i += 1) model.apply(blank());
  const result = model.apply(noisy);

  assert.equal(result.changedPixels, 0, "single-pixel noise must not survive erosion");
});

test("reset() forgets the background model", () => {
  const model = new Mog2(W, H);
  for (let i = 0; i < 8; i += 1) model.apply(blank());
  model.reset();

  const result = model.apply(blank());
  assert.equal(result.frames, 1);
  assert.equal(result.ready, false);
});

test("a frame with the wrong size is rejected", () => {
  const model = new Mog2(W, H);
  assert.throws(() => model.apply(Buffer.alloc(10)), /Expected 3072 bytes/);
});
