/* Atlas — tests for viewer/core.js (the viewer's pure parts). Run: node --test tests/core.test.js
   Node's built-in test runner: nothing to install. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../viewer/core.js');

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const length = ({ x, y, z }) => Math.hypot(x, y, z);

test('hash is repeatable and stays in [0, 1)', () => {
  assert.equal(core.hash('file:app.js'), core.hash('file:app.js'));
  for (const text of ['', 'a', 'folder:.', 'x'.repeat(500)]) {
    const value = core.hash(text);
    assert.ok(value >= 0 && value < 1, `${text}: ${value}`);
  }
});

test('seededRandom gives the same numbers for the same seed', () => {
  const [a, b] = [core.seededRandom(42), core.seededRandom(42)];
  const first = Array.from({ length: 5 }, a);
  assert.deepEqual(first, Array.from({ length: 5 }, b));
  assert.ok(first.every((value) => value >= 0 && value < 1));
  assert.notDeepEqual(first, Array.from({ length: 5 }, core.seededRandom(43)));
});

test('evenSpots gives that many directions, each on the unit sphere', () => {
  const spots = core.evenSpots(500);
  assert.equal(spots.length, 500);
  assert.ok(spots.every((spot) => close(length(spot), 1, 1e-12)));
  const meanY = spots.reduce((sum, spot) => sum + spot.y, 0) / spots.length;
  assert.ok(Math.abs(meanY) < 1e-9, 'spread evenly north and south');
});

test('moveAlong travels the given angle along the surface', () => {
  const start = { x: 0, y: 0, z: 1 };
  const end = core.moveAlong(start, 1.2, 0.3);
  assert.ok(close(length(end), 1, 1e-12));
  const angle = Math.acos(start.x * end.x + start.y * end.y + start.z * end.z);
  assert.ok(close(angle, 0.3, 1e-9));
});

test('surfaceAxes are at right angles to the point and to each other', () => {
  const dir = core.unit({ x: 0.3, y: -0.5, z: 0.8 });
  const { east, north } = core.surfaceAxes(dir);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  assert.ok(close(dot(east, dir), 0, 1e-12) && close(dot(north, dir), 0, 1e-12) && close(dot(east, north), 0, 1e-12));
});

test('a turn survives the trip to a quaternion and back', () => {
  const m = core.multiply(core.turnMatrix(0.7, -0.4), core.turnMatrix(-1.9, 0.2));
  const back = core.fromQuaternion(core.toQuaternion(m));
  m.forEach((value, i) => assert.ok(close(value, back[i], 1e-9), `entry ${i}`));
});

test('slerp starts at a, ends at b, and stays a unit quaternion', () => {
  const a = core.toQuaternion(core.turnMatrix(0.2, 0.1));
  const b = core.toQuaternion(core.turnMatrix(2.5, -0.8));
  const start = core.slerp(a, b, 0);
  const end = core.slerp(a, b, 1);
  a.forEach((value, i) => assert.ok(close(value, start[i], 1e-9)));
  assert.ok(close(Math.abs(b.reduce((s, v, i) => s + v * end[i], 0)), 1, 1e-9), 'same turn as b');
  assert.ok(close(Math.hypot(...core.slerp(a, b, 0.37)), 1, 1e-9));
});

test('straightened keeps a slightly skewed turn orthonormal', () => {
  const skewed = core.turnMatrix(0.5, 0.3).map((value, i) => value + (i % 2 ? 1e-4 : -1e-4));
  const m = core.straightened(skewed);
  const row = (r) => m.slice(r * 3, r * 3 + 3);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  [0, 1, 2].forEach((r) => assert.ok(close(dot(row(r), row(r)), 1, 1e-9)));
  assert.ok(close(dot(row(0), row(1)), 0, 1e-9) && close(dot(row(1), row(2)), 0, 1e-9));
});

test('languageOf maps extensions and languages to colour keys', () => {
  assert.equal(core.languageOf({ type: 'folder' }), 'folder');
  assert.equal(core.languageOf({ type: 'file', lang: 'py' }), 'python');
  assert.equal(core.languageOf({ type: 'file', lang: 'javascript' }), 'javascript');
  assert.equal(core.languageOf({ type: 'function', lang: 'MD' }), 'markdown');
  assert.equal(core.languageOf({ type: 'file', lang: 'png' }), 'other');
  assert.equal(core.languageOf({ type: 'file' }), 'other');
  assert.equal(core.COLORS.length, core.COLOR_KEYS.length);
  assert.ok(core.COLORS.every((colour) => /^#[0-9a-f]{6}$/i.test(colour)));
});

test('webStep pulls two linked dots toward the resting length, then settles', () => {
  const sim = {
    x: Float32Array.from([-200, 200]),
    y: Float32Array.from([0, 0]),
    vx: new Float32Array(2),
    vy: new Float32Array(2),
    edges: Int32Array.from([0, 1]),
    kind: Uint8Array.from([1]),
    held: -1,
  };
  const p = { cell: 60, repel: 140, spring: 0.02, treeLength: 26, linkLength: 70, gravity: 0, damping: 0.82, maxStep: 12 };
  let moving = Infinity;
  for (let step = 0; step < 2000 && moving > 1e-4; step++) moving = core.webStep(sim, p);
  const distance = Math.abs(sim.x[1] - sim.x[0]);
  assert.ok(moving <= 1e-4, 'it comes to rest');
  assert.ok(distance > 55 && distance < 85, `about the resting length (70), got ${distance}`);
});

test('webStep never moves a dot that is being held', () => {
  const sim = {
    x: Float32Array.from([0, 10]),
    y: Float32Array.from([0, 0]),
    vx: new Float32Array(2),
    vy: new Float32Array(2),
    edges: new Int32Array(0),
    kind: new Uint8Array(0),
    held: 0,
  };
  const p = { cell: 60, repel: 140, spring: 0.02, treeLength: 26, linkLength: 70, gravity: 0.01, damping: 0.82, maxStep: 12 };
  for (let step = 0; step < 50; step++) core.webStep(sim, p);
  assert.equal(sim.x[0], 0);
  assert.ok(sim.x[1] > 10, 'the other one is pushed away');
});
