/* ==========================================================================
   Atlas — core.js (viewer)
   --------------------------------------------------------------------------
   The viewer's pure parts: no page and no canvas, so they can be tested on
   their own (node --test tests/core.test.js). app.js reads them from
   window.AtlasCore; graph.html inlines this file just before app.js.

     - colour tables (dot colour = language) and languageOf
     - repeatable randomness: hash, seededRandom
     - sphere geometry: evenSpots, unit, cross, surfaceAxes, moveAlong, discRadius
     - turning: turnMatrix, multiply, straightened, toQuaternion, fromQuaternion, slerp
     - the web view's physics: webStep
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AtlasCore = factory();
})(typeof self === 'undefined' ? this : self, function () {
  'use strict';

  // Soft pastels (user's request): light, gentle colours that still tell the languages apart on the dark sky
  const FOLDER_COLOR = '#f4f1ea'; // warm off-white
  const LANG_COLORS = {
    python: '#a7c7e7', // pastel blue
    javascript: '#fdfd96', // butter yellow
    typescript: '#b5d8ff', // baby blue
    tsx: '#a0e7e5', // pastel aqua
    html: '#ffb3a7', // peach coral
    css: '#d7b8f3', // lavender
    bash: '#b8e6b8', // pastel green
    go: '#9ee0e8', // pastel cyan
    rust: '#f2c9a0', // pastel tan
    sql: '#ffd8a8', // apricot
    swift: '#ffc4a3', // pastel orange
    csharp: '#cdb4db', // lilac
    c: '#c9ccd5', // pastel grey
    java: '#f7c5cc', // blush
    powershell: '#a9c5f5', // periwinkle
    markdown: '#b4f0d4', // pastel mint
    json: '#ffe6a7', // pastel gold
  };
  const OTHER_COLOR = '#c3c7d1'; // soft grey
  /** File extensions that mean a language above ("py" → python). */
  const LANG_ALIASES = {
    py: 'python',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    sh: 'bash',
    zsh: 'bash',
    rs: 'rust',
    cs: 'csharp',
    h: 'c',
    ps1: 'powershell',
    htm: 'html',
    md: 'markdown',
  };
  const COLOR_KEYS = ['folder', ...Object.keys(LANG_COLORS), 'other'];
  const COLORS = COLOR_KEYS.map((key) => (key === 'folder' ? FOLDER_COLOR : LANG_COLORS[key] || OTHER_COLOR));

  /** A stable pseudo-random number in [0, 1) from a string (the same map every time). */
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return ((h >>> 0) % 10000) / 10000;
  }
  /** A repeatable random-number generator (mulberry32): numbers in [0, 1) with no visible pattern
      (the string hash above gives related numbers for related strings, which lined the stars up). */
  function seededRandom(seed) {
    let state32 = seed;
    return () => {
      state32 = (state32 + 0x6d2b79f5) | 0;
      let t = Math.imul(state32 ^ (state32 >>> 15), 1 | state32);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** `count` places spread evenly over the whole globe (a Fibonacci sphere), as directions. The drawn grid has
      twice as many rows as columns per degree, so placing dust on it would stretch each folder's ring into a strip. */
  function evenSpots(count) {
    return Array.from({ length: count }, (_, i) => {
      const y = 1 - (2 * (i + 0.5)) / count;
      const ring = Math.sqrt(1 - y * y);
      const angle = i * 2.399963; // the golden angle, in radians
      return { x: Math.cos(angle) * ring, y, z: Math.sin(angle) * ring };
    });
  }
  /** Plain character order (language settings can't change it). */
  function compareText(a, b) {
    return a < b ? -1 : Number(a > b);
  }
  /** A point's direction from the globe's centre, as a length-1 vector. */
  function unit({ x, y, z }) {
    const length = Math.hypot(x, y, z) || 1;
    return { x: x / length, y: y / length, z: z / length };
  }
  /** The cross product of two vectors (a vector at right angles to both). */
  function cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  }
  /** Two directions along the globe's surface at a point (at right angles to each other). */
  function surfaceAxes(dir) {
    const helper = Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const east = unit(cross(helper, dir));
    return { east, north: cross(dir, east) };
  }
  /** The direction reached by travelling `distance` radians from `dir` along the surface, heading `bearing`. */
  function moveAlong(dir, bearing, distance) {
    const { east, north } = surfaceAxes(dir);
    const [a, b] = [Math.cos(bearing) * Math.sin(distance), Math.sin(bearing) * Math.sin(distance)];
    const c = Math.cos(distance);
    return unit({
      x: dir.x * c + east.x * a + north.x * b,
      y: dir.y * c + east.y * a + north.y * b,
      z: dir.z * c + east.z * a + north.z * b,
    });
  }
  /** How far (radians) a round patch of `count` evenly spaced spots reaches from its middle. */
  function discRadius(count, spacing) {
    return spacing * Math.sqrt(count / Math.PI) * 1.15;
  }
  /** The camera's turn as a 3×3 matrix (nine numbers, row by row): yaw left/right, then tilt up/down. */
  function turnMatrix(yaw, tilt) {
    const [cy, sy, ct, st] = [Math.cos(yaw), Math.sin(yaw), Math.cos(tilt), Math.sin(tilt)];
    return [cy, 0, -sy, -st * sy, ct, -st * cy, ct * sy, st, ct * cy];
  }
  /** Two turns combined: `a` applied after `b`. */
  function multiply(a, b) {
    return a.map((_, i) => {
      const [row, column] = [Math.floor(i / 3), i % 3];
      return a[row * 3] * b[column] + a[row * 3 + 1] * b[column + 3] + a[row * 3 + 2] * b[column + 6];
    });
  }
  /** Remove the tiny rounding errors that build up over a lot of turning, so the globe never skews. */
  function straightened(m) {
    const unit = ([x, y, z]) => [x, y, z].map((value) => value / Math.hypot(x, y, z));
    const a = unit(m.slice(0, 3));
    const dot = a[0] * m[3] + a[1] * m[4] + a[2] * m[5];
    const b = unit([m[3] - dot * a[0], m[4] - dot * a[1], m[5] - dot * a[2]]);
    return [...a, ...b, a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  /** A turn (3×3 matrix, row by row) as a quaternion [w, x, y, z], which can be blended smoothly. */
  function toQuaternion(m) {
    const trace = m[0] + m[4] + m[8];
    if (trace > 0) {
      const s = Math.sqrt(trace + 1) * 2;
      return [s / 4, (m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s];
    }
    if (m[0] > m[4] && m[0] > m[8]) {
      const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
      return [(m[7] - m[5]) / s, s / 4, (m[1] + m[3]) / s, (m[2] + m[6]) / s];
    }
    if (m[4] > m[8]) {
      const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
      return [(m[2] - m[6]) / s, (m[1] + m[3]) / s, s / 4, (m[5] + m[7]) / s];
    }
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    return [(m[3] - m[1]) / s, (m[2] + m[6]) / s, (m[5] + m[7]) / s, s / 4];
  }
  /** A quaternion back to a 3×3 turn (row by row). */
  function fromQuaternion([w, x, y, z]) {
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
      2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
      2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
    ]; // prettier-ignore
  }
  /** The turn `t` of the way from a to b (0 = a, 1 = b), the short way round. */
  function slerp(a, b, t) {
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const to = dot < 0 ? b.map((v) => -v) : b; // the same turn, but the nearer of its two forms
    dot = Math.abs(dot);
    if (dot > 0.9995) {
      const mixed = a.map((v, i) => v + (to[i] - v) * t);
      const length = Math.hypot(...mixed);
      return mixed.map((v) => v / length);
    }
    const angle = Math.acos(dot);
    const [wa, wb] = [Math.sin((1 - t) * angle), Math.sin(t * angle)].map((w) => w / Math.sin(angle));
    return a.map((v, i) => v * wa + to[i] * wb);
  }
  /** The colour key for a node: "folder", a language, or "other". */
  function languageOf(node) {
    if (node.type === 'folder') return 'folder';
    const lang = String(node.lang || '').toLowerCase();
    const key = LANG_ALIASES[lang] || lang;
    return key in LANG_COLORS ? key : 'other';
  }
  /** One step of the web view's physics on `sim` ({x, y, vx, vy, edges, kind, held}; it keeps its own force
      arrays, reused between steps): dots near each other push apart (found through a grid, so it stays fast),
      lines pull their two dots toward a resting length, and everything is drawn gently to the middle.
      `p` holds the settings: cell, repel, spring, treeLength, linkLength, gravity, damping, maxStep.
      Returns how much it still moves, on average. */
  function webStep(sim, p) {
    const { x, y, vx, vy, edges, kind } = sim;
    const count = x.length;
    if (!sim.fx || sim.fx.length !== count) {
      [sim.fx, sim.fy] = [new Float32Array(count), new Float32Array(count)];
    }
    const { fx, fy } = sim;
    fx.fill(0);
    fy.fill(0);
    const cells = new Map();
    const cellOf = (a, b) => Math.floor(a / p.cell) * 100003 + Math.floor(b / p.cell);
    for (let i = 0; i < count; i++) {
      const key = cellOf(x[i], y[i]);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(i);
    }
    for (let i = 0; i < count; i++) pushApart(i, sim, p, cells);
    for (let e = 0; e < edges.length; e += 2) {
      const [a, b] = [edges[e], edges[e + 1]];
      const [dx, dy] = [x[b] - x[a], y[b] - y[a]];
      const d = Math.hypot(dx, dy) || 1;
      const pull = (d - (kind[e / 2] ? p.linkLength : p.treeLength)) * p.spring;
      fx[a] += (dx / d) * pull;
      fy[a] += (dy / d) * pull;
      fx[b] -= (dx / d) * pull;
      fy[b] -= (dy / d) * pull;
    }
    let moving = 0;
    for (let i = 0; i < count; i++) {
      if (i === sim.held) continue;
      vx[i] = (vx[i] + fx[i] - x[i] * p.gravity) * p.damping;
      vy[i] = (vy[i] + fy[i] - y[i] * p.gravity) * p.damping;
      const speed = Math.hypot(vx[i], vy[i]);
      if (speed > p.maxStep) [vx[i], vy[i]] = [(vx[i] / speed) * p.maxStep, (vy[i] / speed) * p.maxStep];
      x[i] += vx[i];
      y[i] += vy[i];
      moving += Math.min(speed, p.maxStep);
    }
    return count ? moving / count : 0;
  }

  /** Dot i and every later dot in its 3 × 3 grid cells push each other apart (closer = harder). */
  function pushApart(i, sim, p, cells) {
    const { x, y, fx, fy } = sim;
    const [cx, cy] = [Math.floor(x[i] / p.cell), Math.floor(y[i] / p.cell)];
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of cells.get(gx * 100003 + gy) || []) {
          if (j <= i) continue;
          let [dx, dy] = [x[i] - x[j], y[i] - y[j]];
          let d2 = dx * dx + dy * dy;
          if (d2 > p.cell * p.cell) continue;
          if (d2 < 1) [dx, dy, d2] = [0.7, ((i + j) % 2) - 0.5, 1]; // on top of each other: nudge apart, repeatably
          const d = Math.sqrt(d2);
          const push = p.repel / d2;
          fx[i] += (dx / d) * push;
          fy[i] += (dy / d) * push;
          fx[j] -= (dx / d) * push;
          fy[j] -= (dy / d) * push;
        }
      }
    }
  }

  return {
    FOLDER_COLOR,
    LANG_COLORS,
    OTHER_COLOR,
    LANG_ALIASES,
    COLOR_KEYS,
    COLORS,
    hash,
    seededRandom,
    evenSpots,
    compareText,
    unit,
    cross,
    surfaceAxes,
    moveAlong,
    discRadius,
    turnMatrix,
    multiply,
    straightened,
    toQuaternion,
    fromQuaternion,
    slerp,
    languageOf,
    webStep,
  };
});
