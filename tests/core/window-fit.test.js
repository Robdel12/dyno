import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, deviceMetrics } from '../../src/providers/chromium-emulation.js';

let laptop = { availWidth: 1512, availHeight: 949 };
let frame = { width: 2, height: 80 };

test('a viewport larger than the screen scales down to fit inside the window frame', () => {
  let scale = fitScale({ width: 1920, height: 1080 }, laptop, frame);
  assert.ok(Math.abs(scale - (1510 / 1920)) < 1e-9);
  assert.ok(Math.ceil(1920 * scale) + frame.width <= laptop.availWidth);
  assert.ok(Math.ceil(1080 * scale) + frame.height <= laptop.availHeight);
});

test('a viewport that already fits is never enlarged', () => {
  assert.equal(fitScale({ width: 1280, height: 800 }, laptop, frame), 1);
});

test('device metrics keep the full viewport and only add a scale when shrinking', () => {
  let plan = { deviceScaleFactor: 2 };
  let viewport = { width: 1920, height: 1080 };
  let fitted = deviceMetrics(plan, viewport, 0.75);
  assert.deepEqual([fitted.width, fitted.height, fitted.deviceScaleFactor, fitted.scale], [1920, 1080, 2, 0.75]);
  assert.equal('scale' in deviceMetrics(plan, viewport, 1), false);
});
