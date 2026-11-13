/* ==========================================================================
   Atlas — app.js (viewer)
   --------------------------------------------------------------------------
   Reads the graph from <script id="graphData"> (inlined by atlas.py build),
   places every folder, file and piece of code as a speck of dust on a globe
   with a 100 × 100 grid (no libraries), drawn on one <canvas>: each folder
   surrounded by its files, each file by its code, dust coloured by language.
   You can search, zoom, pan and turn it; pointing at a speck says what it is.
   The numbers panel shows counts only.

   TABLE OF CONTENTS
     01  Settings
     02  Data & indexes
     03  DOM references & small helpers
     04  State & filters
     05  Layout (the globe grid)
     06  Drawing the map
     07  Zoom, pan & 3D
     08  Selection & highlighting
     09  Numbers panel
     10  Lists & health
     11  Search
     12  Folder tree
     13  Theme, help & announcements
     14  Keyboard shortcuts
     15  Init
   ========================================================================== */
(function () {
  'use strict';

  // Pure maths and colour tables live in core.js (loaded first; tested with node --test tests/core.test.js)
  const {
    COLOR_KEYS,
    COLORS,
    hash,
    seededRandom,
    evenSpots,
    compareText,
    unit,
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
  } = window.AtlasCore;

  /* ==========================================================================
     01  SETTINGS
     ========================================================================== */
  const THEME_KEY = 'atlas-theme'; // also read by the inline script in index.html
  const THEMES = ['auto', 'light', 'dark'];
  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** Node types: label and dust size (map units: small, like dust). Every type is always shown. */
  const TYPES = [
    { type: 'folder', label: 'folders', size: 2 },
    { type: 'file', label: 'files', size: 1.6 },
    { type: 'function', label: 'functions', size: 1 },
    { type: 'class', label: 'classes', size: 1.1 },
    { type: 'html-id', label: 'html ids', size: 0.9 },
    { type: 'css-class', label: 'css classes', size: 0.9 },
  ];
  const HEALTH_TITLES = {
    unused_functions: 'unused functions',
    unused_css_classes: 'unused css classes',
    missing_ids: 'missing ids',
  };
  // The globe
  const GLOBE_RADIUS = 500; // map units (zoom scales it to the screen)
  const GRID = 100; // rows (latitudes) and columns (longitudes) of the grid
  const SPOTS_PER_NODE = 2; // places to choose from, evenly spread over the globe, per speck of dust
  const SCATTER = { tree: 0.006, code: 0.02 }; // how far dust drifts off its place (radians): folders and files
  // barely move, so the rings of files around each folder stay clear; code is more scattered
  const DEPTH_SCATTER = 0.01; // dust floats a little above or below the surface, × the radius
  const HIT_PX = 8; // a click this close to a speck selects it (the specks themselves are tiny)
  const GRID_STEPS = { row: 120, column: 90 }; // straight pieces per grid line: round even when zoomed in
  const POLE_GAP = 8; // degrees: the north–south lines stop this short of each pole, so 100 of them don't knot there
  const GRID_LINE_PX = 0.5; // fine hairlines
  // The satellite: one project (Claude's own folder) drawn as a core inside the globe
  // Claude's core: the satellite project (Claude's own folder) is a small dust ball at the globe's centre,
  // seen through the globe's dust and turning slowly the other way. Rays run from it to every globe file
  // Claude has edited or created (meta.claude_touches, read from Claude Code's logs at build time).
  const CAMERA_DISTANCE = 5; // × the globe's radius: gentle perspective
  const MOON_SIZE = 0.55; // the core's radius, × the globe's (big enough to fill the inside: user's "adjust")
  const MOON_DUST = 0.72; // its dust is a little smaller than the globe's
  const MOON_GRID = 24; // rows and columns of the core's grid
  const CORE_FADE = 0.55; // the core's dust is dimmer, so the nucleus and strands read first
  const CORE_GLOW = { color: '255, 170, 90', alpha: 0.09, reach: 1.5 }; // a warm haze round the core (× its radius)
  // The burst (user's reference: a glowing nucleus with fine strands): a curved strand from the centre to every
  // file on the globe, warm near the nucleus and cooling to blue at the file; files Claude edited glow brightest
  const NUCLEUS = { reach: 0.42, alpha: 0.95 }; // the hot centre: its size (× the core's radius) and strength
  const STRAND_PIECES = 8; // colour steps along a strand (one stroke per step, for all strands together)
  const STRAND_WARM = [255, 196, 112]; // amber, at the nucleus
  const STRAND_MID = [238, 186, 170]; // peach-grey, halfway
  const STRAND_COOL = [128, 178, 240]; // pastel blue, at the file
  const STRAND_ALPHA = { plain: 0.62, claude: 1, far: 0.4, dimmed: 0.04, hot: 0.9 };
  const STRAND_WIDTH = { plain: 0.6, claude: 1.15 };
  const STRAND_BEND = 0.32; // how far a strand curves sideways, × its length (each its own, the same every time)
  const STRAND_SWAY = { reach: 110, push: 46, ease: 0.14 }; // the cursor bends strands near it (px), easing back
  const STRAND_GROW_MS = 2200; // the strands grow out from the nucleus once, when the map opens
  // Light travelling along the strands, from the nucleus out to each file (only while the spin is on)
  const LIGHT_TRIP_S = { plain: 6.5, claude: 4.5 }; // seconds for a light to cross its strand
  const LIGHT_TAIL = 0.09; // a light's fading tail, as a share of its strand
  const LIGHT_TAIL_STEPS = 4; // fade steps along a tail (one stroke each, for all lights together)
  const LIGHT_ALPHA = { plain: 0.55, claude: 1 }; // Claude's strands carry brighter lights (two each)
  const CORE_SPIN = 0.02; // radians a second the other way from the globe's spin, so the two layers drift apart
  const RAY_COLOR = '#c9b8ff'; // pastel lavender
  const RAY_ALPHA = { min: 0.3, max: 0.8, far: 0.45, dimmed: 0.05, hot: 0.95 }; // more edits = brighter
  const RAY_WIDTH = 0.8;
  // The web view (section 06b): a flat web of folders and files, settled by a small physics simulation
  const VIEW_KEY = 'atlas-view';
  const MAP_HINTS = {
    globe: 'drag to turn · shift+drag to pan · scroll to zoom · point at or click a speck',
    web: 'drag to move · drag a dot to pull it · scroll to zoom · point at or click a dot',
  };
  const WEB_SEED = 20261113; // the same starting places every time
  const WEB_DOT = 0.9; // a speck's size with no links (web units)…
  const WEB_DOT_GROWTH = 0.28; // …plus this × the square root of its number of lines (dust, not balls)
  const WEB_CODE_DOT = 0.45; // code parts: the finest dust, floating round their own file
  const WEB_CODE_REACH = [2, 18]; // how far from its file a code speck floats (web units): a soft cloud
  const WEB_MAX_DOT_PX = { tree: 2.6, code: 1.3 }; // dust stays dust when you zoom in (screen pixels)
  const WEB_SHADES = 4; // dust brightness steps (each speck gets one, so the dust shimmers unevenly)
  const WEB_TREE_LENGTH = 26; // a folder → inside line's resting length
  const WEB_LINK_LENGTH = 70; // a file-to-file line's resting length
  const WEB_SPRING = 0.02; // how hard lines pull toward their length
  const WEB_REPEL = 140; // how hard nearby dots push apart
  const WEB_CELL = 60; // dots further apart than this don't push (keeps each step fast)
  const WEB_GRAVITY = 0.0006; // a gentle pull to the middle, so separate groups don't drift away
  const WEB_DAMPING = 0.82; // speed kept each step (the rest is friction)
  const WEB_MAX_STEP = 12; // furthest a dot moves in one step
  const WEB_STEPS_PER_FRAME = 3;
  const WEB_SETTLE_STEPS = 900; // the most it runs after opening (it usually rests sooner)
  const WEB_DRAG_STEPS = 240; // how long it keeps moving after you pull a dot
  const WEB_REST = 0.05; // average movement per step below which it stops
  const WEB_PHYSICS = {
    cell: WEB_CELL,
    repel: WEB_REPEL,
    spring: WEB_SPRING,
    treeLength: WEB_TREE_LENGTH,
    linkLength: WEB_LINK_LENGTH,
    gravity: WEB_GRAVITY,
    damping: WEB_DAMPING,
    maxStep: WEB_MAX_STEP,
  };
  const WEB_LINE = '#9aa3c7'; // soft periwinkle grey
  const WEB_LINE_ALPHA = { tree: 0.07, link: 0.2 }; // faint threads, so the dust stands out
  const MAX_PICK_LABELS = 80; // names shown at once for a picked language or kind (only where they don't overlap)
  const MAX_NEAR_LABELS = 12; // neighbours named around a selection (a page can link to 100+ ids)
  const MIN_ZOOM = 0.05;
  const FIT_MARGIN = 56; // px kept free around the globe when fitting
  const STAR_COUNT = 900; // background stars all around the sky (about a quarter are in view at once)
  const STAR_LEVELS = 4; // stars are drawn in this many brightness groups (one fill each)
  // Drawing (the map is always a dark sky, in both themes)
  const MAP_BG = '#05060d';
  const GRID_COLOR = '#8fb4ff';
  const GRID_ALPHA = { front: 0.22, back: 0.07 };
  const STAR_COOL = '#dfe8ff';
  const STAR_WARM = '#ffe2c4';
  const LABEL_COLOR = '#e6edf3';
  const SELECTED_COLOR = '#ffffff';
  const ACCENT = '#3ddc97';
  const MAX_PIXEL_RATIO = 2; // full Retina sharpness (still painted only when something moves)
  const MIN_DOT_PX = 0.6; // far, zoomed-out dust never shrinks below this
  const MIN_DOT_ALPHA = 0.22;
  const ALPHA_LEVELS = 16; // dust is drawn in this many brightness steps per colour (one fill each)
  const FOCUS_FADE = 0.2; // while something is selected, unrelated dust keeps this share of its brightness
  const OFF_SCREEN_PX = 12; // dust this far outside the map isn't drawn
  const NO_BUCKET = 65535; // marks a speck that isn't drawn this frame
  const RING_GAP_PX = 3; // the ring round a selected or pointed-at speck
  const HOVER_PX = 6; // pointing this close to a speck shows what it is
  const LINK_KINDS = new Set(['imports', 'loads', 'calls', 'uses']); // links between files (not drawn: used to light up
  // what's linked when you click or pick something)
  // Motion: the globe spins slowly, Claude's core turns the other way and light flows along the rays (the spin
  // button, or S, stops it all)
  const SPIN_KEY = 'atlas-spin';
  const SPIN_SPEED = 0.01; // radians a second: the globe turns once in about 10½ minutes (user's choice)
  const MOTION_FPS = 30; // while only the spin moves, repaint this often: smooth for the travelling strand lights
  // (user's request); dragging and zooming repaint at full speed; nothing when the spin is off
  /** Dot colour = language, in pastels (folders off-white; anything not listed is OTHER). */
  const SKY_REACH = 0.55; // how far the sky spreads, × the map's diagonal (just past its corners)
  const STAR_SEED = 20261108; // the same sky every time
  const ZOOM_STEP = 1.25;
  const MAX_ZOOM = 6;
  const GLIDE_TO_MS = 650; // how long the globe takes to turn and zoom to something you picked
  const ZOOM_EASE = 0.22; // each frame covers this share of the way to the target zoom (smooth, not stepped)
  const PAN_STEP = 60;
  // Turning
  const TURN_SPEED = 0.008; // radians per pixel dragged
  const TURN_STEP = 0.15; // radians per arrow key
  const GLIDE_DECAY = 0.94; // after letting go, the spin keeps this share of its speed each frame
  const GLIDE_STOP = 0.0004; // radians per frame: slow enough to stop
  const GLIDE_RECENT_MS = 80; // only glide if the pointer was still moving when it let go
  /** Arrow key → direction the map content moves (x, y). */
  const PAN_KEYS = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

  /* ==========================================================================
     02  DATA & INDEXES
     ========================================================================== */
  const DATA = readData();
  const nodeById = new Map(DATA.nodes.map((node) => [node.id, node]));
  const edgesOut = groupBy(DATA.edges, 'source');
  const edgesIn = groupBy(DATA.edges, 'target');
  const healthOf = healthIndex(DATA.health || {});
  const PROJECTS = (DATA.meta.projects || []).length > 1 ? DATA.meta.projects : []; // combined maps only
  const SATELLITE = DATA.meta.satellite || ''; // the project drawn as Claude's core (e.g. ".claude"), or ''
  const TOUCHES = DATA.meta.claude_touches || {}; // file id → {edits, writes}: files Claude edited or created
  let rays = []; // globe files Claude touched: {index (speck), weight 0–1 by how often} (set by makeRays)
  let strands = []; // every globe file and folder: {index, weight (Claude's edits, 0 if none), bend, sway (now), push (target)}

  /** Whether a node belongs to the moon (its path starts with the satellite project's name). */
  function isMoon(node) {
    return Boolean(SATELLITE) && String(node.file || '').split('/')[0] === SATELLITE;
  }

  /** The inlined graph JSON, or an empty graph (e.g. the template opened directly). */
  function readData() {
    try {
      const data = JSON.parse(document.getElementById('graphData').textContent);
      return { meta: {}, nodes: [], edges: [], health: {}, errors: [], ...data };
    } catch (error) {
      console.error('Atlas: the graph data could not be read', error);
      return { meta: {}, nodes: [], edges: [], health: {}, errors: [] };
    }
  }

  /** Map of key value → list of edges. */
  function groupBy(edges, key) {
    const map = new Map();
    edges.forEach((edge) => {
      if (!map.has(edge[key])) map.set(edge[key], []);
      map.get(edge[key]).push(edge);
    });
    return map;
  }

  /** node id → health check title, for the "possibly unused" badges. */
  function healthIndex(health) {
    const index = new Map();
    Object.entries(health).forEach(([check, ids]) => {
      ids.forEach((id) => index.set(id, HEALTH_TITLES[check]));
    });
    return index;
  }

  /* ==========================================================================
     03  DOM REFERENCES & SMALL HELPERS
     ========================================================================== */
  const byId = (id) => document.getElementById(id);
  const els = {
    projectName: byId('projectName'),
    helpBtn: byId('helpBtn'),
    themeBtn: byId('themeBtn'),
    searchInput: byId('searchInput'),
    searchStatus: byId('searchStatus'),
    searchResults: byId('searchResults'),
    tree: byId('tree'),
    layout: document.querySelector('.layout'),
    numbersBtn: byId('numbersBtn'),
    mapEmpty: byId('mapEmpty'),
    themeColor: byId('themeColor'),
    healthList: byId('healthList'),
    graph: byId('graph'), // the <canvas>
    tooltip: byId('tooltip'),
    legend: byId('legend'),
    legendList: byId('legendList'),
    spinBtn: byId('spinBtn'),
    mapHint: byId('mapHint'),
    zoomInBtn: byId('zoomInBtn'),
    zoomOutBtn: byId('zoomOutBtn'),
    fitBtn: byId('fitBtn'),
    details: byId('details'),
    detailsTitle: byId('detailsTitle'),
    detailsBody: byId('detailsBody'),
    helpDialog: byId('helpDialog'),
    announcer: byId('announcer'),
  };

  /** An HTML element with optional class and text (text is never parsed as HTML). */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** An SVG element with attributes. */
  function svgEl(tag, attributes = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)));
    return node;
  }

  /** "assets/js/app.js:612" (or just the file). */
  function where(node) {
    return node.line ? `${node.file}:${node.line}` : node.file;
  }

  /** "app.js:12", or "my_site/app.js:12" in a combined map (for lists). */
  function shortWhere(node) {
    return node.line ? `${fileLabel(node.file)}:${node.line}` : '';
  }

  /** The TYPES entry for a node type. */
  function typeInfo(type) {
    return TYPES.find((entry) => entry.type === type) || TYPES[1];
  }

  /* ==========================================================================
     04  STATE & FILTERS
     ========================================================================== */
  const state = {
    theme: 'auto',
    positions: new Map(), // node id → {x, y, z} on the globe (placed once)
    view: { x: 0, y: 0, k: 1 },
    camera: { rotation: turnMatrix(0.5, -0.35), distance: GLOBE_RADIUS * CAMERA_DISTANCE }, // how the globe is turned, then perspective
    glide: null, // the spin still coasting after letting go
    zoom: null, // a zoom still easing toward its target: {target, anchor, frame}
    move: null, // the globe gliding to something you picked: {from, to, start, frame}
    box: { width: 0, height: 0 }, // the map's size on screen, measured when it changes (not every frame)
    frame: 0, // a pending requestAnimationFrame (a redraw)
    spinning: false, // the globe spinning (and the core turning the other way)
    spinFrame: 0, // the spin's running requestAnimationFrame
    lastDraw: 0, // when the map was last painted (ms)
    coreTurn: 0, // radians the core has turned (against the globe's spin)
    pointer: null, // where the cursor is over the map (px), for the strands' sway
    growStart: 0, // when the strands began growing out (ms)
    lightClock: 0, // seconds the strand lights have travelled (only while spinning, so they freeze when it stops)
    lastTick: 0, // the spin's last frame (ms), to move on by the time passed
    mode: 'globe', // 'globe' or 'web' (section 06b)
    views: {}, // each mode's own zoom and position, kept while the other is shown
    selected: null,
    cardAfterGlide: null, // a node picked from a list: its card shows once the glide ends
    pick: null, // a language (colour key) or kind of item (numbers panel) picked to stand out: {by, key}, or null
    drag: null, // the pointer gesture in progress (section 07)
  };

  /* ==========================================================================
     05  LAYOUT — the globe: every folder, file and piece of code is a speck of
     dust on a globe drawn with a 100 × 100 grid (the dust isn't placed on it). Each
     folder is surrounded by its files and subfolders (the nearest free grid
     points, ring by ring), each subfolder by its own, and each file by its code.
     Projects start from their own spots, spread over the globe. Placed once.
     ========================================================================== */
  /** Positions for every node (all of them, so hiding a type never moves the rest). Returns the projects'
      top folders, biggest first. */
  function layoutGlobe() {
    const roots = layoutGroup(DATA.nodes.filter((node) => !isMoon(node)));
    const moon = DATA.nodes.filter(isMoon);
    if (moon.length) {
      layoutGroup(moon); // the moon is laid out the same way, on its own sphere…
      moon.forEach((node) => {
        const p = state.positions.get(node.id); // …then shrunk: its positions are kept around its own centre
        state.positions.set(node.id, { x: p.x * MOON_SIZE, y: p.y * MOON_SIZE, z: p.z * MOON_SIZE });
      });
    }
    return roots;
  }

  /** Place one group of nodes (the globe's, or the moon's) on a sphere of their own. Returns its top folders. */
  function layoutGroup(nodes) {
    const grid = evenSpots(Math.max(1000, nodes.length * SPOTS_PER_NODE)); // not the grid: round rings need even spacing
    const free = new Uint8Array(grid.length).fill(1);
    const take = (node, near) => {
      const dir = nearestFreeSpot(grid, free, near, node.id);
      const drift = ['folder', 'file'].includes(node.type) ? SCATTER.tree : SCATTER.code;
      state.positions.set(node.id, scattered(dir, node.id, drift));
      return dir; // neighbours are placed around the spot itself, so groups stay together
    };
    const inGroup = new Set(nodes.map((node) => node.id));
    const children = childrenByFolder();
    const roots = treeRoots(children).filter((node) => inGroup.has(node.id));
    const spacing = Math.sqrt((4 * Math.PI) / grid.length); // the angle between neighbouring spots
    const room = { children, take, spacing, sizes: new Map() };
    spreadDirections(roots.length).forEach((seed, i) => surround(roots[i], take(roots[i], seed), room));
    placeCode(take, roots, nodes);
    return roots;
  }

  /** folder id → the files and subfolders inside it (files first, then folders, each by name). */
  function childrenByFolder() {
    const children = new Map();
    DATA.edges
      .filter((edge) => edge.kind === 'contains' && nodeById.has(edge.target))
      .forEach((edge) => {
        if (!children.has(edge.source)) children.set(edge.source, []);
        children.get(edge.source).push(nodeById.get(edge.target));
      });
    const order = (a, b) => (a.type === b.type ? compareText(a.name, b.name) : a.type === 'file' ? -1 : 1);
    children.forEach((list) => list.sort(order));
    return children;
  }

  /** The tops of the folder trees (each project's own folder), biggest first; loose files count as tops too. */
  function treeRoots(children) {
    const inside = new Set([...children.values()].flat().map((node) => node.id));
    const size = (node) => 1 + (children.get(node.id) || []).reduce((sum, child) => sum + size(child), 0);
    return DATA.nodes
      .filter((node) => ['folder', 'file'].includes(node.type) && !inside.has(node.id))
      .map((node) => [node, size(node)])
      .sort((a, b) => b[1] - a[1] || compareText(a[0].name, b[0].name))
      .map(([node]) => node);
  }

  /** Put a folder's files and subfolders on the nearest free spots around it, then do the same for each subfolder. */
  function surround(folder, dir, room) {
    const kids = room.children.get(folder.id) || [];
    const files = kids.filter((kid) => !room.children.has(kid.id));
    const folders = kids.filter((kid) => room.children.has(kid.id));
    files.forEach((file) => room.take(file, dir)); // the files: a ring (a disc) right around the folder
    const ring = discRadius(files.length + 1, room.spacing);
    folders.forEach((sub, i) => {
      // each subfolder gets its own room just outside the ring, so its files can surround it too
      const away = ring + discRadius(treeSize(sub, room), room.spacing) + room.spacing;
      const bearing = (2 * Math.PI * i) / folders.length + hash(folder.id) * Math.PI;
      surround(sub, room.take(sub, moveAlong(dir, bearing, away)), room);
    });
  }

  /** How many folders and files are in a folder, itself included (remembered once worked out). */
  function treeSize(folder, room) {
    if (!room.sizes.has(folder.id)) {
      const kids = room.children.get(folder.id) || [];
      room.sizes.set(folder.id, 1 + kids.reduce((sum, kid) => sum + treeSize(kid, room), 0));
    }
    return room.sizes.get(folder.id);
  }

  /** Each piece of code goes on the nearest free spot to its own file (in line order). */
  function placeCode(take, roots, nodes) {
    const fallback = roots.length ? unit(state.positions.get(roots[0].id)) : { x: 0, y: 0, z: -1 };
    nodes
      .filter((node) => !['folder', 'file'].includes(node.type))
      .sort((a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.name, b.name))
      .forEach((node) => {
        const home = state.positions.get(`file:${node.file}`);
        take(node, home ? unit(home) : fallback);
      });
  }

  /** The free grid spot nearest a direction (and take it). With no spot left, a point just beside it. */
  function nearestFreeSpot(grid, free, near, id) {
    let best = -1;
    let bestDot = -2;
    for (let i = 0; i < grid.length; i++) {
      if (!free[i]) continue;
      const dot = grid[i].x * near.x + grid[i].y * near.y + grid[i].z * near.z;
      if (dot > bestDot) [best, bestDot] = [i, dot];
    }
    if (best < 0) return unit({ x: near.x + hash(id) * 0.02, y: near.y + hash(`${id}y`) * 0.02, z: near.z });
    free[best] = 0;
    return grid[best];
  }

  /** A speck's place: near its spot, drifted a random (repeatable) little way (up to `drift` radians) along the
      surface and a touch above or below it, so the dust looks scattered rather than lined up. */
  function scattered(dir, id, drift) {
    const { east, north } = surfaceAxes(dir);
    const [angle, reach] = [hash(`${id}a`) * Math.PI * 2, Math.sqrt(hash(`${id}r`)) * drift];
    const [a, b] = [Math.cos(angle) * reach, Math.sin(angle) * reach];
    const moved = unit({
      x: dir.x + east.x * a + north.x * b,
      y: dir.y + east.y * a + north.y * b,
      z: dir.z + east.z * a + north.z * b,
    });
    const height = GLOBE_RADIUS * (1 + (hash(`${id}h`) - 0.5) * 2 * DEPTH_SCATTER);
    return { x: moved.x * height, y: moved.y * height, z: moved.z * height };
  }

  /** `count` directions spread evenly over the globe: where each project starts. */
  function spreadDirections(count) {
    return evenSpots(count);
  }

  /** Degrees north (+) or south (−) of a grid row: rows sit between the poles, never on them. */
  function gridLatitude(row) {
    return 90 - ((row + 0.5) * 180) / GRID;
  }

  /** Degrees east of a grid column. */
  function gridLongitude(column) {
    return (column * 360) / GRID;
  }

  /** A point on the globe's surface (north is up). */
  function onGlobe(lat, lon) {
    const [phi, lambda] = [(lat * Math.PI) / 180, (lon * Math.PI) / 180];
    return {
      x: GLOBE_RADIUS * Math.cos(phi) * Math.cos(lambda),
      y: -GLOBE_RADIUS * Math.sin(phi),
      z: GLOBE_RADIUS * Math.cos(phi) * Math.sin(lambda),
    };
  }

  /* ==========================================================================
     06  DRAWING THE MAP — one <canvas>: stars, grid, dust, rings and names are
     painted in that order, only when something changes (never on a timer, so
     nothing is drawn while the globe sits still and the Mac stays cool).
     ========================================================================== */
  /** Everything the painter needs, as flat number arrays (fast to draw 3,000+ specks every frame). */
  const paint = {
    ctx: null,
    n: 0, // how many specks
    ids: [], // speck index → node id
    index: new Map(), // node id → speck index
    pos: null, // x, y, z on the globe per speck
    sx: null, // where each speck is drawn now (pixels in the map)
    sy: null,
    ss: null, // its perspective scale (nearer = bigger)
    depth: null, // bigger = farther
    size: null, // dust radius (map units)
    color: null, // index into COLOR_KEYS
    near: null, // 1 = the selection or linked to it
    core: null, // 1 = one of the picked language's or kind's own items (named on the globe)
    moon: null, // 1 = on the moon (its pos is around the moon's centre)
    world: null, // x, y, z of every speck now (the moon's move as it circles)
    moonGrid: [], // the moon's grid lines (around its own centre)
    order: null, // scratch: specks sorted by brightness and colour
    bucket: null, // scratch: each speck's brightness-and-colour group (NO_BUCKET = off screen)
    counts: null, // scratch: specks per group
    stars: [], // groups of background stars: {color, alpha, list: [indexes]}
    starDir: null, // x, y, z per star (a direction in the sky)
    starSize: null,
    grid: [], // per grid line: x, y, z of its points
    font: 'monospace',
    hover: -1, // the speck under the pointer, or -1
  };
  const spot = { x: 0, y: 0, s: 1, depth: 0 }; // scratch filled by toScreen (no new object per point)

  /** The colour of a node's speck. */
  function colorOf(node) {
    return COLORS[COLOR_KEYS.indexOf(languageOf(node))];
  }

  /** Get the canvas ready and copy every node into the flat arrays (after layoutGlobe). */
  function setUpCanvas() {
    paint.ctx = els.graph.getContext('2d');
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
    paint.font = mono || 'monospace';
    const n = DATA.nodes.length;
    paint.n = n;
    paint.ids = DATA.nodes.map((node) => node.id);
    paint.index = new Map(paint.ids.map((id, i) => [id, i]));
    paint.pos = new Float32Array(n * 3);
    ['sx', 'sy', 'ss', 'depth', 'size'].forEach((key) => (paint[key] = new Float32Array(n)));
    paint.color = new Uint8Array(n);
    paint.near = new Uint8Array(n);
    paint.core = new Uint8Array(n);
    paint.moon = new Uint8Array(n);
    paint.order = new Int32Array(n);
    paint.bucket = new Uint16Array(n);
    paint.counts = new Int32Array(ALPHA_LEVELS * COLOR_KEYS.length + 1);
    DATA.nodes.forEach((node, i) => {
      const point = state.positions.get(node.id) || { x: 0, y: 0, z: 0 };
      paint.pos.set([point.x, point.y, point.z], i * 3);
      paint.moon[i] = isMoon(node) ? 1 : 0;
      paint.size[i] = typeInfo(node.type).size * (paint.moon[i] ? MOON_DUST : 1);
      paint.color[i] = COLOR_KEYS.indexOf(languageOf(node));
    });
    paint.world = Float32Array.from(paint.pos); // the globe's dust never moves; the core's turns each frame
    makeRays();
    updateWorld();
    sizeCanvas();
  }

  /** The core's centre: the globe's centre. */
  function moonCentre() {
    return { x: 0, y: 0, z: 0 };
  }

  /** The rays: one per globe file Claude touched (files inside Claude's own folder are part of the core, so
      they get none), brighter the more often (log scale, so one busy file doesn't drown the rest). */
  function makeRays() {
    const total = ({ edits = 0, writes = 0 }) => edits + writes;
    const most = Math.max(1, ...Object.values(TOUCHES).map(total));
    rays = Object.entries(TOUCHES)
      .filter(([id]) => paint.index.has(id) && !paint.moon[paint.index.get(id)])
      .map(([id, counts]) => ({
        index: paint.index.get(id),
        weight: Math.log1p(total(counts)) / Math.log1p(most),
      }));
    const claude = new Map(rays.map((ray) => [ray.index, ray.weight]));
    strands = paint.ids
      .map((id, i) => [id, i])
      .filter(([id, i]) => !paint.moon[i] && ['file', 'folder'].includes(nodeById.get(id).type))
      .map(([id, i]) => ({
        index: i,
        weight: claude.has(i) ? claude.get(i) : 0,
        bend: (hash(`${id}bend`) * 2 - 1) * STRAND_BEND,
        sway: 0,
        push: 0,
      }));
  }

  /** Turn the core's dust by `state.coreTurn` round the north–south axis (the globe's dust stays put). */
  function updateWorld() {
    if (!SATELLITE) return;
    const [c, s] = [Math.cos(state.coreTurn), Math.sin(state.coreTurn)];
    const { pos, world, moon } = paint;
    for (let i = 0; i < paint.n; i++) {
      if (!moon[i]) continue;
      const [x, z] = [pos[i * 3], pos[i * 3 + 2]];
      world[i * 3] = x * c - z * s;
      world[i * 3 + 1] = pos[i * 3 + 1];
      world[i * 3 + 2] = x * s + z * c;
    }
  }

  /** A node's position in space now (the moon's nodes move with it), or undefined. */
  function worldPoint(id) {
    const i = paint.index.get(id);
    if (i === undefined) return state.positions.get(id);
    return { x: paint.world[i * 3], y: paint.world[i * 3 + 1], z: paint.world[i * 3 + 2] };
  }

  /** Match the canvas's pixels to its size on screen (sharp on Retina, capped so it stays light). */
  function sizeCanvas() {
    const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
    const [width, height] = [state.box.width, state.box.height].map((size) =>
      Math.max(1, Math.round(size * ratio)),
    );
    if (width === els.graph.width && height === els.graph.height) return; // resizing wipes the canvas: only when needed
    els.graph.width = width;
    els.graph.height = height;
    if (paint.ctx) paint.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawSoon();
  }

  /** Redraw everything for the current selection (the dust keeps its place on the globe). */
  function redraw() {
    els.mapEmpty.hidden = DATA.nodes.length > 0;
    if (state.selected && !paint.index.has(state.selected)) state.selected = null;
    highlight();
  }

  /** Paint the whole map now. */
  function drawMap() {
    const ctx = paint.ctx;
    if (!ctx) return;
    const { width, height } = state.box;
    state.lastDraw = performance.now();
    updateWorld();
    ctx.globalAlpha = 1;
    ctx.fillStyle = MAP_BG;
    ctx.fillRect(0, 0, width, height);
    drawStars(ctx);
    if (state.mode === 'web') {
      drawWeb(ctx);
      drawRings(ctx);
      drawNames(ctx); // only after a click or pick: the web shows no names by itself
      return;
    }
    // Inside out: Claude's core (dimmer), its rays to the files Claude touched, then the globe over them
    if (SATELLITE) {
      drawCoreGlow(ctx);
      drawGrid(ctx, 1, CORE_FADE);
      drawDust(ctx, 1, CORE_FADE);
    }
    drawStrands(ctx);
    if (SATELLITE) drawNucleus(ctx);
    drawGrid(ctx, 0);
    drawDust(ctx, 0);
    drawRings(ctx);
    drawNames(ctx);
  }

  /** A warm haze round Claude's core, fading out toward the globe: the inside looks lit by the nucleus. */
  function drawCoreGlow(ctx) {
    toScreen(0, 0, 0);
    const radius = GLOBE_RADIUS * MOON_SIZE * spot.s * state.view.k;
    const reach = radius * CORE_GLOW.reach;
    const glow = ctx.createRadialGradient(spot.x, spot.y, radius * 0.2, spot.x, spot.y, reach);
    glow.addColorStop(0, `rgba(${CORE_GLOW.color}, ${CORE_GLOW.alpha})`);
    glow.addColorStop(0.6, `rgba(${CORE_GLOW.color}, ${CORE_GLOW.alpha * 0.45})`);
    glow.addColorStop(1, `rgba(${CORE_GLOW.color}, 0)`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, reach, 0, Math.PI * 2);
    ctx.fill();
  }

  /** The hot centre: white at the middle, then gold and orange, fading out (drawn additively, over the strands'
      roots, so they seem to burst out of it). */
  function drawNucleus(ctx) {
    toScreen(0, 0, 0);
    const reach = GLOBE_RADIUS * MOON_SIZE * NUCLEUS.reach * spot.s * state.view.k;
    const glow = ctx.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, reach);
    glow.addColorStop(0, `rgba(255, 250, 235, ${NUCLEUS.alpha})`);
    glow.addColorStop(0.12, `rgba(255, 222, 140, ${NUCLEUS.alpha * 0.85})`);
    glow.addColorStop(0.35, `rgba(255, 150, 60, ${NUCLEUS.alpha * 0.45})`);
    glow.addColorStop(0.7, `rgba(220, 80, 40, ${NUCLEUS.alpha * 0.12})`);
    glow.addColorStop(1, 'rgba(200, 60, 30, 0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, reach, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  /** The colour of strand piece k (0 = at the nucleus): warm amber, through peach, to pastel blue. */
  const STRAND_COLORS = Array.from({ length: STRAND_PIECES }, (_, k) => {
    const t = (k + 0.5) / STRAND_PIECES;
    const [a, b, u] = t < 0.5 ? [STRAND_WARM, STRAND_MID, t * 2] : [STRAND_MID, STRAND_COOL, (t - 0.5) * 2];
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(', ')})`;
  });

  /** How far the strands have grown (0 → 1) since the map opened (all the way at once for less motion). */
  function strandGrowth() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 1;
    if (!state.growStart) state.growStart = performance.now();
    const t = Math.min(1, (performance.now() - state.growStart) / STRAND_GROW_MS);
    return 1 - (1 - t) ** 3; // fast, then easing in
  }

  /** A fine curved strand from the nucleus to every globe file: a quadratic curve bent to its own side, coloured
      warm → cool in STRAND_PIECES exact pieces (one stroke per piece and group, for all strands together); files
      Claude edited are brighter and thicker; the far side is dimmer; the cursor bends nearby strands away. */
  function drawStrands(ctx) {
    if (!SATELLITE || !strands.length) return;
    const focus = isFocused();
    const grow = strandGrowth();
    const groups = ['plain', 'far', 'claude', 'dimmed'];
    const paths = groups.map(() => Array.from({ length: STRAND_PIECES }, () => new Path2D()));
    toScreen(0, 0, 0);
    const [cx, cy] = [spot.x, spot.y];
    let moving = grow < 1;
    const lights = { tails: Array.from({ length: LIGHT_TAIL_STEPS }, () => new Path2D()), heads: [] };
    strands.forEach((strand) => {
      const i = strand.index;
      toScreen(paint.world[i * 3], paint.world[i * 3 + 1], paint.world[i * 3 + 2]);
      const [ex, ey, far] = [spot.x, spot.y, spot.depth > 0];
      const [dx, dy] = [ex - cx, ey - cy];
      const length = Math.hypot(dx, dy) || 1;
      const [nx, ny] = [-dy / length, dx / length];
      const [mx, my] = [cx + dx / 2, cy + dy / 2];
      strand.push = swayTarget(mx + nx * strand.bend * length, my + ny * strand.bend * length, nx, ny);
      strand.sway += (strand.push - strand.sway) * STRAND_SWAY.ease;
      if (Math.abs(strand.push - strand.sway) > 0.3) moving = true;
      const bend = strand.bend * length + strand.sway;
      const [kx, ky] = [mx + nx * bend * 2, my + ny * bend * 2]; // the control point (the curve passes halfway)
      const group = focus ? (paint.near[i] ? 2 : 3) : strand.weight > 0 ? 2 : far ? 1 : 0;
      addStrandPieces(paths[group], cx, cy, kx, ky, ex, ey, grow);
      if (grow >= 1) addLights(lights, strand, group, [cx, cy, kx, ky, ex, ey]);
    });
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    groups.forEach((name, g) => {
      const alpha = focus
        ? g === 2
          ? STRAND_ALPHA.hot
          : STRAND_ALPHA.dimmed
        : STRAND_ALPHA[name === 'far' ? 'plain' : name];
      ctx.lineWidth = name === 'claude' ? STRAND_WIDTH.claude : STRAND_WIDTH.plain;
      paths[g].forEach((path, k) => {
        ctx.strokeStyle = STRAND_COLORS[k];
        ctx.globalAlpha = alpha * (name === 'far' ? STRAND_ALPHA.far : 1) * (1 - 0.35 * (k / STRAND_PIECES));
        ctx.stroke(path);
      });
    });
    drawLights(ctx, lights);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
    if (moving) drawSoon(); // still growing or swaying: keep painting until it settles
  }

  /** Add this strand's travelling lights: one (two on Claude's strands, evenly apart), each at its own place
      along the curve (offset by the strand's bend, so they're never in step). Faded strands carry none. */
  function addLights(lights, strand, group, curve) {
    if (group === 3) return; // dimmed while something else is picked
    const claude = group === 2;
    const count = claude ? 2 : 1;
    const trip = claude ? LIGHT_TRIP_S.claude : LIGHT_TRIP_S.plain;
    for (let n = 0; n < count; n++) {
      const t = (((state.lightClock / trip + (strand.bend + 1) * 3.7 + n / count) % 1) + 1) % 1;
      const alpha = (claude ? LIGHT_ALPHA.claude : LIGHT_ALPHA.plain) * (group === 1 ? STRAND_ALPHA.far : 1);
      for (let k = 0; k < LIGHT_TAIL_STEPS; k++) {
        const a = Math.max(0, t - LIGHT_TAIL * (1 - k / LIGHT_TAIL_STEPS));
        const b = Math.max(0, t - LIGHT_TAIL * (1 - (k + 1) / LIGHT_TAIL_STEPS));
        if (b > a) addCurveSection(lights.tails[k], curve, a, b);
      }
      lights.heads.push({ at: curvePoint(curve, t), t, alpha, claude });
    }
  }

  /** The point `t` (0 → 1) along a quadratic curve [ax, ay, kx, ky, bx, by]. */
  function curvePoint([ax, ay, kx, ky, bx, by], t) {
    const [u, v, w] = [(1 - t) * (1 - t), 2 * t * (1 - t), t * t];
    return [u * ax + v * kx + w * bx, u * ay + v * ky + w * by];
  }

  /** Add the exact section of a quadratic curve between t = a and t = b to a path. */
  function addCurveSection(path, curve, a, b) {
    const [ax, ay, kx, ky, bx, by] = curve;
    const [sa, sb] = [curvePoint(curve, a), curvePoint(curve, b)];
    const [qa, qb] = [(1 - a) * (1 - b), (1 - a) * b + a * (1 - b)];
    path.moveTo(sa[0], sa[1]);
    path.quadraticCurveTo(qa * ax + qb * kx + a * b * bx, qa * ay + qb * ky + a * b * by, sb[0], sb[1]);
  }

  /** Paint the lights: tails that fade and thin behind each head (shared strokes), then each head as a small
      glow in its strand's colour at that point (warm near the nucleus, blue near the file) with a white centre. */
  function drawLights(ctx, { tails, heads }) {
    if (!heads.length) return;
    tails.forEach((path, k) => {
      const f = (k + 1) / LIGHT_TAIL_STEPS; // 1 at the head
      ctx.strokeStyle = '#fff6e8';
      ctx.lineWidth = 0.5 + 1.1 * f;
      ctx.globalAlpha = 0.5 * f * f;
      ctx.stroke(path);
    });
    heads.forEach(({ at: [x, y], t, alpha, claude }) => {
      const radius = claude ? 4.5 : 3;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, 'rgba(255, 252, 240, 1)');
      glow.addColorStop(0.35, STRAND_COLORS[Math.min(STRAND_PIECES - 1, Math.floor(t * STRAND_PIECES))]);
      glow.addColorStop(1, 'rgba(128, 178, 240, 0)');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /** How far the cursor pushes a strand sideways (px, along its normal): strands within STRAND_SWAY.reach of the
      pointer bend away from it, more the closer they are; 0 when the pointer is away. */
  function swayTarget(px, py, nx, ny) {
    const pointer = state.pointer;
    if (!pointer) return 0;
    const [ax, ay] = [px - pointer.x, py - pointer.y];
    const distance = Math.hypot(ax, ay);
    if (distance > STRAND_SWAY.reach) return 0;
    const side = ax * nx + ay * ny >= 0 ? 1 : -1;
    return side * STRAND_SWAY.push * (1 - distance / STRAND_SWAY.reach) ** 2;
  }

  /** Add one strand's curve (A → control K → B) to the pieces, cut at `grow` (0 → 1) while the strands grow.
      Each piece is an exact section of the curve (a section of a quadratic is a quadratic). */
  function addStrandPieces(pieces, ax, ay, kx, ky, bx, by, grow) {
    for (let k = 0; k < STRAND_PIECES; k++) {
      const a = k / STRAND_PIECES;
      if (a >= grow) break;
      addCurveSection(pieces[k], [ax, ay, kx, ky, bx, by], a, Math.min(grow, (k + 1) / STRAND_PIECES));
    }
  }

  /** Paint on the next frame (turning fires many pointer events per frame). */
  function drawSoon() {
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      drawMap();
    });
  }

  /** How far a point is from you (bigger = farther), after the globe's turn. */
  function turnedDepth({ x, y, z }) {
    const r = state.camera.rotation;
    return r[6] * x + r[7] * y + r[8] * z;
  }

  /** Where a globe point is drawn now, in pixels in the map (written into `spot`). */
  function toScreen(x, y, z) {
    const r = state.camera.rotation;
    const { distance } = state.camera;
    const { view } = state;
    const tx = r[0] * x + r[1] * y + r[2] * z;
    const ty = r[3] * x + r[4] * y + r[5] * z;
    const depth = r[6] * x + r[7] * y + r[8] * z;
    const s = distance / Math.max(distance * 0.2, distance + depth);
    spot.x = view.x + tx * s * view.k;
    spot.y = view.y + ty * s * view.k;
    spot.s = s;
    spot.depth = depth;
    return spot;
  }

  /** A speck's radius on screen (never smaller than MIN_DOT_PX, so far dust doesn't vanish). */
  function dotRadius(i) {
    if (state.mode === 'web') {
      const tree = web.of[i] >= 0;
      const size = (tree ? web.radius[web.of[i]] : WEB_CODE_DOT) * state.view.k;
      return Math.max(MIN_DOT_PX, Math.min(tree ? WEB_MAX_DOT_PX.tree : WEB_MAX_DOT_PX.code, size));
    }
    return Math.max(MIN_DOT_PX, paint.size[i] * paint.ss[i] * state.view.k);
  }

  /** Every speck, in groups of the same brightness and colour (one fill per group): far, dim ones first.
      Nearer dust is brighter; while something is selected, unrelated dust fades. */
  function drawDust(ctx, part = 0, fade = 1) {
    const { n, world, sx, sy, ss, depth, color, near, order, bucket, counts, moon } = paint;
    const { width, height } = state.box;
    const colors = COLOR_KEYS.length;
    const reach = GLOBE_RADIUS * (1 + DEPTH_SCATTER);
    const moonReach = reach * MOON_SIZE;
    const moonDepth = SATELLITE ? turnedDepth(moonCentre()) : 0; // the moon is shaded against its own centre
    const focus = isFocused();
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      if (moon[i] !== part) continue; // 0 = the globe's dust, 1 = the moon's (drawn in separate passes)
      toScreen(world[i * 3], world[i * 3 + 1], world[i * 3 + 2]);
      sx[i] = spot.x;
      sy[i] = spot.y;
      ss[i] = spot.s;
      depth[i] = spot.depth;
      if (
        spot.x < -OFF_SCREEN_PX ||
        spot.y < -OFF_SCREEN_PX ||
        spot.x > width + OFF_SCREEN_PX ||
        spot.y > height + OFF_SCREEN_PX
      ) {
        bucket[i] = NO_BUCKET;
        continue;
      }
      const t = moon[i]
        ? (spot.depth - moonDepth + moonReach) / (2 * moonReach)
        : (spot.depth + reach) / (2 * reach); // 0 = nearest
      let alpha = Math.min(1, Math.max(MIN_DOT_ALPHA, 0.3 + 0.7 * (1 - t)));
      if (focus && !near[i]) alpha *= FOCUS_FADE;
      alpha *= fade;
      const level = Math.min(ALPHA_LEVELS - 1, Math.floor(alpha * ALPHA_LEVELS));
      bucket[i] = level * colors + color[i];
      counts[bucket[i] + 1] += 1;
    }
    for (let b = 1; b < counts.length; b++) counts[b] += counts[b - 1]; // where each group starts in `order`
    const fill = counts.slice(); // next free place per group (one small copy per frame)
    for (let i = 0; i < n; i++) if (moon[i] === part && bucket[i] !== NO_BUCKET) order[fill[bucket[i]]++] = i;
    for (let b = 0; b < counts.length - 1; b++) {
      if (counts[b] === counts[b + 1]) continue;
      ctx.globalAlpha = (Math.floor(b / colors) + 0.5) / ALPHA_LEVELS;
      ctx.fillStyle = COLORS[b % colors];
      ctx.beginPath();
      for (let j = counts[b]; j < counts[b + 1]; j++) {
        const i = order[j];
        const radius = dotRadius(i);
        ctx.moveTo(sx[i] + radius, sy[i]);
        ctx.arc(sx[i], sy[i], radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---- Links: arcs between files that load, import, call or use each other ---- */
  /** One link per pair of files (both directions merged), as flat arrays. */
  function makeLinks() {
    const pairs = new Set(); // "a,b": one link per pair of files, whichever way and however often
    DATA.edges.forEach((edge) => {
      if (!LINK_KINDS.has(edge.kind)) return;
      const [a, b] = [fileOf(nodeById.get(edge.source)), fileOf(nodeById.get(edge.target))];
      if (a < 0 || b < 0 || a === b) return;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      pairs.add(key);
    });
    const count = pairs.size;
    Object.assign(paint, {
      linkA: new Int32Array(count),
      linkB: new Int32Array(count),
      linkHot: new Uint8Array(count), // 1 = a link of the selection or pick (what lights up)
      linkCount: count,
      linkIndex: new Map([...pairs].map((key, i) => [key, i])), // "a,b" → link number
    });
    [...pairs].forEach((key, i) => {
      const [a, b] = key.split(',').map(Number);
      paint.linkA[i] = a;
      paint.linkB[i] = b;
    });
  }

  /** The speck index of the file a node is in (the file itself for a file; -1 for a folder). */
  function fileOf(node) {
    if (!node || node.type === 'folder') return -1;
    const id = node.type === 'file' ? node.id : `file:${node.file}`;
    return paint.index.has(id) ? paint.index.get(id) : -1;
  }

  /** The link number joining two files' specks, or -1. */
  function linkBetween(a, b) {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    return paint.linkIndex.has(key) ? paint.linkIndex.get(key) : -1;
  }

  /** Mark the selection's own links: a file's, every file inside a folder, or a piece of code's file. */
  function markHotLinks() {
    paint.linkHot.fill(0);
    if (state.pick && state.pick.by === 'language') {
      // a language picked in the key: every link with one of its files at either end
      const pick = COLOR_KEYS.indexOf(state.pick.key);
      for (let i = 0; i < paint.linkCount; i++) {
        if (paint.color[paint.linkA[i]] === pick || paint.color[paint.linkB[i]] === pick) {
          paint.linkHot[i] = 1;
        }
      }
      return;
    }
    if (state.pick) {
      // a kind of item picked in the numbers panel: the links its items take part in
      DATA.edges.forEach((edge) => {
        if (!LINK_KINDS.has(edge.kind)) return;
        const [from, to] = [nodeById.get(edge.source), nodeById.get(edge.target)];
        if (!from || !to || (from.type !== state.pick.key && to.type !== state.pick.key)) return;
        const link = linkBetween(fileOf(from), fileOf(to));
        if (link >= 0) paint.linkHot[link] = 1;
      });
      return;
    }
    if (!state.selected) return;
    const node = nodeById.get(state.selected);
    const files = new Set();
    const collect = (id) => {
      const item = nodeById.get(id);
      if (!item) return;
      if (item.type === 'file') files.add(paint.index.get(id));
      (edgesOut.get(id) || [])
        .filter((edge) => edge.kind === 'contains')
        .forEach((edge) => collect(edge.target));
    };
    if (node.type === 'folder' || node.type === 'file') collect(node.id);
    else if (paint.index.has(`file:${node.file}`)) files.add(paint.index.get(`file:${node.file}`));
    for (let i = 0; i < paint.linkCount; i++) {
      if (files.has(paint.linkA[i]) || files.has(paint.linkB[i])) paint.linkHot[i] = 1;
    }
  }

  /** Spin on: the globe turns on its own north–south axis and the core turns the other way, repainting about
      MOTION_FPS times a second. It waits while you drag or a glide runs, and stops when switched off (the
      browser also pauses it while the page is hidden). */
  function animateSpin(now) {
    if (!state.spinning) {
      state.spinFrame = 0;
      return;
    }
    const seconds = Math.min(0.25, Math.max(0, (now - (state.lastTick || now)) / 1000));
    state.lastTick = now;
    const busy = (state.drag && state.drag.moved) || state.move || state.glide || state.mode === 'web'; // the web doesn't spin
    if (!busy) {
      state.camera.rotation = straightened(
        multiply(state.camera.rotation, turnMatrix(seconds * SPIN_SPEED, 0)),
      );
      if (SATELLITE) state.coreTurn = (state.coreTurn - seconds * (SPIN_SPEED + CORE_SPIN)) % (2 * Math.PI); // against the globe
      state.lightClock += seconds;
      if (now - state.lastDraw >= 1000 / MOTION_FPS - 4) drawMap(); // a little early, so timing jitter doesn't skip one
    }
    state.spinFrame = requestAnimationFrame(animateSpin);
  }

  /** Switch the spin on or off (remembered on this computer). */
  function setSpin(on, remember = true) {
    state.spinning = on;
    els.spinBtn.setAttribute('aria-pressed', String(on));
    state.lastTick = 0; // carry on from where it is, without a jump
    if (on && !state.spinFrame) state.spinFrame = requestAnimationFrame(animateSpin);
    if (!remember) return;
    try {
      localStorage.setItem(SPIN_KEY, on ? 'on' : 'off');
    } catch (error) {
      console.warn('Atlas: could not save the spin setting', error);
    }
  }

  /** The saved spin setting: on, unless switched off before or the Mac asks for less motion. */
  function readSpin() {
    try {
      const saved = localStorage.getItem(SPIN_KEY);
      if (saved) return saved === 'on';
    } catch {
      // no storage: use the default
    }
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** A ring round the selected speck (white) and the one under the pointer (mint). */
  function drawRings(ctx) {
    const ring = (i, colour, width) => {
      if (i < 0 || paint.bucket[i] === NO_BUCKET) return;
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(paint.sx[i], paint.sy[i], dotRadius(i) + RING_GAP_PX, 0, Math.PI * 2);
      ctx.stroke();
    };
    ring(state.selected ? paint.index.get(state.selected) : -1, SELECTED_COLOR, 1.5);
    if (paint.hover !== paint.index.get(state.selected)) ring(paint.hover, ACCENT, 1);
  }

  /** Names for the selected speck (white, a little bigger) and its nearest neighbours. */
  function drawNames(ctx) {
    if (state.pick) return drawPickedNames(ctx);
    const named = namedNearSelection();
    if (!named.size) return;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = MAP_BG;
    named.forEach((id) => {
      const i = paint.index.get(id);
      if (i === undefined || paint.bucket[i] === NO_BUCKET) return;
      const node = nodeById.get(id);
      const text = node.type === 'file' ? fileLabel(node.name) : node.name;
      const selected = id === state.selected;
      ctx.font = selected ? `600 12px ${paint.font}` : `500 11px ${paint.font}`;
      ctx.fillStyle = selected ? SELECTED_COLOR : LABEL_COLOR;
      const [x, y] = [paint.sx[i] + dotRadius(i) + 6, paint.sy[i] + 4];
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    });
  }

  /** A picked language's or kind's items, named on the side facing you: nearest first, as many as fit without
      overlapping (at most MAX_PICK_LABELS); the rest show up as you turn or zoom. */
  function drawPickedNames(ctx) {
    const { n, core, bucket, depth, sx, sy } = paint;
    const order = [];
    for (let i = 0; i < n; i++) if (core[i] && bucket[i] !== NO_BUCKET && depth[i] <= 0) order.push(i);
    order.sort((a, b) => depth[a] - depth[b]); // nearest first
    ctx.font = `500 11px ${paint.font}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = MAP_BG;
    ctx.fillStyle = LABEL_COLOR;
    const charWidth = ctx.measureText('M').width; // the font is monospace: one width for every letter
    const taken = []; // boxes already used: x1, y1, x2, y2
    for (const i of order) {
      if (taken.length >= MAX_PICK_LABELS * 4) break;
      const node = nodeById.get(paint.ids[i]);
      const text = node.type === 'file' ? fileLabel(node.name) : baseName(node.name);
      const [x, y] = [sx[i] + dotRadius(i) + 5, sy[i] + 4];
      const box = [x - 2, y - 11, x + text.length * charWidth + 2, y + 3];
      let free = true;
      for (let t = 0; t < taken.length && free; t += 4) {
        free = box[2] < taken[t] || box[0] > taken[t + 2] || box[3] < taken[t + 1] || box[1] > taken[t + 3];
      }
      if (!free) continue;
      taken.push(...box);
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    }
  }

  /** The selection and the neighbours to name: its folder and folder contents first, at most MAX_NEAR_LABELS
      of them (the rest are still highlighted, just not named, so the names don't pile up). */
  function namedNearSelection() {
    if (!state.selected) return new Set();
    const inTree = (edge) => edge.kind === 'contains';
    const tree = new Set([
      ...(edgesOut.get(state.selected) || []).filter(inTree).map((edge) => edge.target),
      ...(edgesIn.get(state.selected) || []).filter(inTree).map((edge) => edge.source),
    ]);
    const shown = (id) => paint.index.has(id);
    const others = [...nearSelection()].filter((id) => id !== state.selected && !tree.has(id));
    return new Set([state.selected, ...[...tree].filter(shown), ...others].slice(0, MAX_NEAR_LABELS + 1));
  }

  /** A small dot in a node's colour, for lists (16×16 SVG). */
  function shapeIcon(node) {
    const svg = svgEl('svg', {
      class: 'shape',
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    svg.append(svgEl('circle', { cx: 8, cy: 8, r: 4, fill: colorOf(node) }));
    return svg;
  }

  /** The background stars (the same pattern every time), all around the sky, in a few brightness groups. */
  function makeStars() {
    const random = seededRandom(STAR_SEED);
    paint.starDir = new Float32Array(STAR_COUNT * 3);
    paint.starSize = new Float32Array(STAR_COUNT);
    const groups = new Map();
    for (let i = 0; i < STAR_COUNT; i++) {
      const bright = random();
      paint.starDir.set(skyDirection(random() * 2 - 1, random() * Math.PI * 2), i * 3);
      paint.starSize[i] = 0.4 + bright * bright * 1.2;
      const level = Math.min(STAR_LEVELS - 1, Math.floor(bright * STAR_LEVELS));
      const key = `${level}${i % 7 === 0 ? 'w' : ''}`; // one star in seven is warm
      if (!groups.has(key)) {
        groups.set(key, {
          color: i % 7 === 0 ? STAR_WARM : STAR_COOL,
          alpha: 0.25 + ((level + 0.5) / STAR_LEVELS) * 0.6,
          list: [],
        });
      }
      groups.get(key).list.push(i);
    }
    paint.stars = [...groups.values()];
  }

  /** A direction from height (-1 to 1) and angle: spreads stars evenly over the whole sky. */
  function skyDirection(height, angle) {
    const ring = Math.sqrt(1 - height * height);
    return [ring * Math.cos(angle), height, ring * Math.sin(angle)];
  }

  /** The stars: only the half of the sky in front of you shows, and it turns with the globe. */
  function drawStars(ctx) {
    const { width, height } = state.box;
    const reach = Math.hypot(width, height) * SKY_REACH;
    const r = state.camera.rotation;
    const dir = paint.starDir;
    paint.stars.forEach((group) => {
      ctx.globalAlpha = group.alpha;
      ctx.fillStyle = group.color;
      ctx.beginPath();
      group.list.forEach((i) => {
        const [x, y, z] = [dir[i * 3], dir[i * 3 + 1], dir[i * 3 + 2]];
        if (r[6] * x + r[7] * y + r[8] * z <= 0) return; // behind you
        const px = width / 2 + (r[0] * x + r[1] * y + r[2] * z) * reach;
        const py = height / 2 + (r[3] * x + r[4] * y + r[5] * z) * reach;
        const size = paint.starSize[i];
        ctx.moveTo(px + size, py);
        ctx.arc(px, py, size, 0, Math.PI * 2);
      });
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /** The globe's grid: its 100 rows and 100 columns, as lists of points (worked out once). */
  function makeGrid() {
    const line = (points) => Float32Array.from(points.flatMap((p) => [p.x, p.y, p.z]));
    if (SATELLITE) paint.moonGrid = makeMoonGrid(line);
    paint.grid = [];
    for (let i = 0; i < GRID; i++) {
      const lat = gridLatitude(i);
      const lon = gridLongitude(i);
      paint.grid.push(
        line(Array.from({ length: GRID_STEPS.row + 1 }, (_, s) => onGlobe(lat, (s * 360) / GRID_STEPS.row))),
      );
      paint.grid.push(
        line(
          Array.from({ length: GRID_STEPS.column + 1 }, (_, s) =>
            onGlobe(90 - POLE_GAP - (s * (180 - 2 * POLE_GAP)) / GRID_STEPS.column, lon),
          ),
        ),
      );
    }
  }

  /** The moon's smaller grid (MOON_GRID rows and columns), around its own centre. */
  function makeMoonGrid(line) {
    const r = MOON_SIZE;
    const scaled = (p) => ({ x: p.x * r, y: p.y * r, z: p.z * r });
    const lines = [];
    for (let i = 0; i < MOON_GRID; i++) {
      const lat = 90 - ((i + 0.5) * 180) / MOON_GRID;
      const lon = (i * 360) / MOON_GRID;
      lines.push(line(Array.from({ length: 49 }, (_, s) => scaled(onGlobe(lat, (s * 360) / 48)))));
      lines.push(
        line(
          Array.from({ length: 37 }, (_, s) =>
            scaled(onGlobe(90 - POLE_GAP - (s * (180 - 2 * POLE_GAP)) / 36, lon)),
          ),
        ),
      );
    }
    return lines;
  }

  /** The grid as the globe is turned now: two paths, the half facing you a little brighter (the moon's too). */
  function drawGrid(ctx, part = 0, fade = 1) {
    const paths = [new Path2D(), new Path2D()]; // front, back
    if (part === 0) addGridLines(paths, paint.grid, { x: 0, y: 0, z: 0 });
    else addGridLines(paths, paint.moonGrid, moonCentre());
    strokeGrid(ctx, paths, fade);
  }

  /** Add grid lines around a centre to the front and back paths. */
  function addGridLines(paths, lines, centre) {
    const centreDepth = turnedDepth(centre);
    lines.forEach((points) => {
      let side = -1;
      for (let j = 0; j < points.length; j += 3) {
        toScreen(points[j] + centre.x, points[j + 1] + centre.y, points[j + 2] + centre.z);
        const now = spot.depth - centreDepth <= 0 ? 0 : 1;
        if (now === side) paths[now].lineTo(spot.x, spot.y);
        else paths[now].moveTo(spot.x, spot.y);
        side = now;
      }
    });
  }

  /** Stroke the grid: the far half fainter. */
  function strokeGrid(ctx, paths, fade = 1) {
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = GRID_LINE_PX;
    ctx.globalAlpha = GRID_ALPHA.back * fade;
    ctx.stroke(paths[1]);
    ctx.globalAlpha = GRID_ALPHA.front * fade;
    ctx.stroke(paths[0]);
    ctx.globalAlpha = 1;
  }

  /** "Dot colour = language": folders, then each language with its number of files, largest first. */
  function renderLegend() {
    const files = DATA.nodes.filter((node) => node.type === 'file');
    const counts = new Map();
    files.forEach((node) => counts.set(languageOf(node), (counts.get(languageOf(node)) || 0) + 1));
    const folders = DATA.nodes.filter((node) => node.type === 'folder').length;
    const rows = [
      ['folder', 'folders', folders],
      ...[...counts].sort((a, b) => b[1] - a[1]).map(([key, count]) => [key, key, count]),
    ];
    els.legendList.replaceChildren(
      ...rows.map(([key, label, count]) => {
        const item = el('li');
        const button = el('button', 'legend-btn');
        button.type = 'button';
        button.dataset.key = key;
        button.dataset.pick = `language:${key}`;
        button.setAttribute('aria-pressed', 'false');
        button.title = `Show where ${label} ${key === 'folder' ? 'are' : 'files are used'}`;
        const dot = el('span', 'legend-dot');
        dot.style.background = COLORS[COLOR_KEYS.indexOf(key)];
        button.append(
          dot,
          el('span', 'legend-name', label),
          el('span', 'legend-count', count.toLocaleString('en')),
        );
        button.addEventListener('click', () => pick('language', key));
        item.append(button);
        return item;
      }),
    );
    if (rays.length) {
      const item = el('li', 'legend-rays');
      const line = el('span', 'legend-ray');
      item.append(
        line,
        el('span', 'legend-name', 'Claude edited'),
        el('span', 'legend-count', rays.length.toLocaleString('en')),
      );
      els.legendList.append(item);
    }
    els.legend.hidden = !DATA.nodes.length;
    if (window.matchMedia('(width < 700px)').matches) els.legend.open = false; // phones: folded, to keep the globe clear
  }

  /** "app.js", or "my_site/app.js" in a combined map (files' names repeat across projects). */
  function fileLabel(path) {
    const parts = path.split('/');
    return DATA.meta.projects ? `${parts[0]}/${parts[parts.length - 1]}` : parts[parts.length - 1];
  }

  /** Where a layout point is drawn, in map units before zoom and pan: turned by the camera, then in perspective. */
  function project(point) {
    const r = state.camera.rotation;
    const [x, y, depth] = [
      r[0] * point.x + r[1] * point.y + r[2] * point.z,
      r[3] * point.x + r[4] * point.y + r[5] * point.z,
      r[6] * point.x + r[7] * point.y + r[8] * point.z,
    ]; // around the globe's centre; bigger depth = farther
    const { distance } = state.camera;
    const s = distance / Math.max(distance * 0.2, distance + depth);
    return { x: x * s, y: y * s, s, depth };
  }

  /* ==========================================================================
     06b  WEB VIEW — a flat web, like graphify's: every folder and file is a dot
     (coloured by language, bigger with more links), with lines from each folder
     to what's inside it and between files that load, import, call or use each
     other. A small physics simulation (springs along the lines, dots pushing
     apart, a pull to the middle) settles it, then stops: nothing is drawn while
     it sits still. Built here, no libraries.
     ========================================================================== */
  const web = {
    ready: false,
    nodes: null, // web dot → speck index
    of: null, // speck index → web dot (-1: not in the web, e.g. a function)
    x: null, // positions and speeds (web units)
    y: null,
    vx: null,
    vy: null,
    radius: null, // dot size (web units)
    edges: null, // pairs of web dots
    kind: null, // per line: 0 = folder → what's inside, 1 = a link between files
    held: -1, // the dot being dragged, or -1
    fitted: false, // fitted into view once it first settled
    heat: 0, // simulation steps left before it rests
    frame: 0,
  };

  /** Build the web once (the first time it's shown): dots, lines, sizes and starting places. */
  function makeWeb() {
    const list = [];
    for (let i = 0; i < paint.n; i++) {
      const type = nodeById.get(paint.ids[i]).type;
      if (type === 'folder' || type === 'file') list.push(i);
    }
    const count = list.length;
    web.nodes = Int32Array.from(list);
    web.of = new Int32Array(paint.n).fill(-1);
    list.forEach((i, w) => (web.of[i] = w));
    const dotOf = (id) => (paint.index.has(id) ? web.of[paint.index.get(id)] : -1);
    const pairs = [];
    const kinds = [];
    const children = new Map();
    DATA.edges.forEach((edge) => {
      if (edge.kind !== 'contains') return;
      const [a, b] = [dotOf(edge.source), dotOf(edge.target)];
      if (a < 0 || b < 0) return;
      pairs.push(a, b);
      kinds.push(0);
      if (!children.has(a)) children.set(a, []);
      children.get(a).push(b);
    });
    for (let l = 0; l < paint.linkCount; l++) {
      const [a, b] = [web.of[paint.linkA[l]], web.of[paint.linkB[l]]];
      if (a < 0 || b < 0) continue;
      pairs.push(a, b);
      kinds.push(1);
    }
    web.edges = Int32Array.from(pairs);
    web.kind = Uint8Array.from(kinds);
    const degree = new Float32Array(count);
    for (let e = 0; e < pairs.length; e += 2) {
      degree[pairs[e]] += 1;
      degree[pairs[e + 1]] += 1;
    }
    web.radius = Float32Array.from(degree, (d) => WEB_DOT + Math.sqrt(d) * WEB_DOT_GROWTH);
    ['x', 'y', 'vx', 'vy'].forEach((key) => (web[key] = new Float32Array(count)));
    placeWebStart(children);
    makeCodeDust(dotOf);
    web.ready = true;
  }

  /** Code parts as dust: each floats at its own (repeatable) spot round its file's dot; every speck gets a
      brightness step, so the dust looks uneven, like the globe's. */
  function makeCodeDust(dotOf) {
    const [codes, homes, ox, oy] = [[], [], [], []];
    for (let i = 0; i < paint.n; i++) {
      if (web.of[i] >= 0) continue;
      const node = nodeById.get(paint.ids[i]);
      const home = dotOf(`file:${node.file}`);
      if (home < 0) continue;
      const angle = hash(`${node.id}a`) * Math.PI * 2;
      const reach = WEB_CODE_REACH[0] + hash(`${node.id}r`) * (WEB_CODE_REACH[1] - WEB_CODE_REACH[0]); // denser near the file
      codes.push(i);
      homes.push(home);
      ox.push(Math.cos(angle) * reach);
      oy.push(Math.sin(angle) * reach);
    }
    Object.assign(web, {
      codes: Int32Array.from(codes),
      codeHome: Int32Array.from(homes),
      codeX: Float32Array.from(ox),
      codeY: Float32Array.from(oy),
      shade: Uint8Array.from(paint.ids, (id) => Math.floor(hash(`${id}s`) * WEB_SHADES)),
    });
  }

  /** Starting places: each top folder on a big circle, and everything inside a folder scattered just round
      it (folder by folder), so the simulation only has to tidy up, not untangle. Repeatable. */
  function placeWebStart(children) {
    const random = seededRandom(WEB_SEED);
    const inside = new Set([...children.values()].flat());
    const roots = [...Array(web.nodes.length).keys()].filter((w) => !inside.has(w));
    const ring = WEB_LINK_LENGTH * Math.sqrt(roots.length) * 2;
    const placed = new Uint8Array(web.nodes.length);
    const queue = [];
    roots.forEach((w, k) => {
      const angle = (2 * Math.PI * k) / roots.length;
      web.x[w] = Math.cos(angle) * ring;
      web.y[w] = Math.sin(angle) * ring;
      placed[w] = 1;
      queue.push(w);
    });
    while (queue.length) {
      const parent = queue.shift();
      (children.get(parent) || []).forEach((kid) => {
        if (placed[kid]) return;
        const [angle, reach] = [random() * Math.PI * 2, WEB_TREE_LENGTH * (0.6 + random() * 0.8)];
        web.x[kid] = web.x[parent] + Math.cos(angle) * reach;
        web.y[kid] = web.y[parent] + Math.sin(angle) * reach;
        placed[kid] = 1;
        queue.push(kid);
      });
    }
  }

  /** One step of the physics (core.js webStep), with the web view's settings. */
  function webTick() {
    return webStep(web, WEB_PHYSICS);
  }

  /** Let the simulation run for up to `steps` steps (it stops sooner once the web is still). */
  function wakeWeb(steps) {
    web.heat = Math.max(web.heat, steps);
    if (!web.frame) web.frame = requestAnimationFrame(stepWeb);
  }

  /** A frame of the simulation: a few steps, then draw. */
  function stepWeb() {
    web.frame = 0;
    if (state.mode !== 'web' || web.heat <= 0) return;
    let moving = 0;
    for (let s = 0; s < WEB_STEPS_PER_FRAME; s++) moving = webTick();
    web.heat -= WEB_STEPS_PER_FRAME;
    if (moving < WEB_REST && web.held < 0) web.heat = 0; // still enough: rest (no more drawing)
    if (web.heat <= 0 && !web.fitted) {
      web.fitted = true; // the first time it settles, fit the whole web into view
      fitWeb(paint.ids, false);
    }
    drawMap();
    if (web.heat > 0) web.frame = requestAnimationFrame(stepWeb);
  }

  /** Paint the web: lines, then dots (by colour), then rings and names. Also fills the screen positions
      (paint.sx, sy, bucket) so pointing, clicking and names work as on the globe. */
  function drawWeb(ctx) {
    const { x, y, nodes, edges, kind } = web;
    const { k, x: vx, y: vy } = state.view;
    const { width, height } = state.box;
    paint.bucket.fill(NO_BUCKET);
    for (let w = 0; w < nodes.length; w++) {
      const i = nodes[w];
      const [sx, sy] = [vx + x[w] * k, vy + y[w] * k];
      paint.sx[i] = sx;
      paint.sy[i] = sy;
      paint.ss[i] = 1;
      paint.depth[i] = 0;
      const out =
        sx < -OFF_SCREEN_PX ||
        sy < -OFF_SCREEN_PX ||
        sx > width + OFF_SCREEN_PX ||
        sy > height + OFF_SCREEN_PX;
      paint.bucket[i] = out ? NO_BUCKET : 0;
    }
    for (let c = 0; c < web.codes.length; c++) {
      const [i, home] = [web.codes[c], web.codeHome[c]];
      const [sx, sy] = [vx + (x[home] + web.codeX[c]) * k, vy + (y[home] + web.codeY[c]) * k];
      paint.sx[i] = sx;
      paint.sy[i] = sy;
      paint.ss[i] = 1;
      paint.depth[i] = 0;
      const out =
        sx < -OFF_SCREEN_PX ||
        sy < -OFF_SCREEN_PX ||
        sx > width + OFF_SCREEN_PX ||
        sy > height + OFF_SCREEN_PX;
      paint.bucket[i] = out ? NO_BUCKET : 0;
    }
    const focus = isFocused();
    const lines = [new Path2D(), new Path2D(), new Path2D()]; // folder → inside, file links, the selection's
    for (let e = 0; e < edges.length; e += 2) {
      const [a, b] = [nodes[edges[e]], nodes[edges[e + 1]]];
      const hot = focus && paint.near[a] && paint.near[b];
      const path = lines[hot ? 2 : kind[e / 2]];
      path.moveTo(paint.sx[a], paint.sy[a]);
      path.lineTo(paint.sx[b], paint.sy[b]);
    }
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = WEB_LINE;
    ctx.globalAlpha = focus ? 0.04 : WEB_LINE_ALPHA.tree;
    ctx.stroke(lines[0]);
    ctx.globalAlpha = focus ? 0.06 : WEB_LINE_ALPHA.link;
    ctx.stroke(lines[1]);
    ctx.strokeStyle = SELECTED_COLOR;
    ctx.globalAlpha = 0.75;
    ctx.stroke(lines[2]);
    drawWebRays(ctx, focus);
    drawWebDots(ctx, focus);
    ctx.globalAlpha = 1;
  }

  /** In the web, Claude's rays are lavender threads from the .claude folder's dot to each file it touched. */
  function drawWebRays(ctx, focus) {
    const root = SATELLITE ? paint.index.get(`folder:${SATELLITE}/.`) : undefined;
    if (root === undefined || !rays.length) return;
    const [bright, faint] = [new Path2D(), new Path2D()];
    rays.forEach(({ index: i }) => {
      const path = !focus || paint.near[i] ? bright : faint;
      path.moveTo(paint.sx[root], paint.sy[root]);
      path.lineTo(paint.sx[i], paint.sy[i]);
    });
    ctx.strokeStyle = RAY_COLOR;
    ctx.lineWidth = RAY_WIDTH;
    ctx.globalAlpha = focus ? RAY_ALPHA.hot : RAY_ALPHA.max * 0.6;
    ctx.stroke(bright);
    ctx.globalAlpha = RAY_ALPHA.dimmed;
    ctx.stroke(faint);
    ctx.globalAlpha = 1;
  }

  /** The web's dust: folders, files and code parts, one fill per colour × brightness step (× faded while
      something is picked). */
  function drawWebDots(ctx, focus) {
    const colors = COLOR_KEYS.length;
    const paths = Array.from({ length: colors * WEB_SHADES * 2 }, () => new Path2D());
    const add = (i) => {
      if (paint.bucket[i] === NO_BUCKET) return;
      const faded = focus && !paint.near[i] ? 1 : 0;
      const path = paths[(paint.color[i] * WEB_SHADES + web.shade[i]) * 2 + faded];
      const radius = dotRadius(i);
      path.moveTo(paint.sx[i] + radius, paint.sy[i]);
      path.arc(paint.sx[i], paint.sy[i], radius, 0, Math.PI * 2);
    };
    web.codes.forEach(add); // the finest dust first, under the folders and files
    web.nodes.forEach(add);
    paths.forEach((path, p) => {
      const shade = (p >> 1) % WEB_SHADES;
      ctx.fillStyle = COLORS[Math.floor((p >> 1) / WEB_SHADES)];
      ctx.globalAlpha = (0.45 + (0.55 * (shade + 1)) / WEB_SHADES) * (p & 1 ? 0.15 : 1);
      ctx.fill(path);
    });
  }

  /** The web dot for a node: itself, or (for a piece of code) the file it's in; -1 if none. */
  function webDotFor(id) {
    const node = nodeById.get(id);
    if (!node) return -1;
    const own = paint.index.has(id) ? web.of[paint.index.get(id)] : -1;
    if (own >= 0) return own;
    const file = `file:${node.file}`;
    return paint.index.has(file) ? web.of[paint.index.get(file)] : -1;
  }

  /** Fit web dots (all of them, or those of these nodes) into the map, gliding there. */
  function fitWeb(ids, instant) {
    const dots = [...new Set(ids.map(webDotFor).filter((w) => w >= 0))];
    if (!dots.length) return;
    const xs = dots.map((w) => web.x[w]);
    const ys = dots.map((w) => web.y[w]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const box = els.graph.getBoundingClientRect();
    const room = (size) => Math.max(40, size - FIT_MARGIN * 2);
    const k = Math.max(
      MIN_ZOOM,
      Math.min(2.5, room(box.width) / (maxX - minX || 1), room(box.height) / (maxY - minY || 1)),
    );
    const view = {
      x: box.width / 2 - ((minX + maxX) / 2) * k,
      y: box.height / 2 - ((minY + maxY) / 2) * k,
      k,
    };
    glideTo(state.camera.rotation, view, instant);
  }

  /** Show the globe or the web (remembered on this computer). Each keeps its own zoom and position. */
  function setMode(mode, remember = true) {
    if (mode !== 'globe' && mode !== 'web') return;
    stopMove();
    stopZoom();
    stopGlide();
    const first = !state.views[mode];
    state.views[state.mode] = { ...state.view };
    state.mode = mode;
    if (mode === 'web' && !web.ready) makeWeb();
    if (!first) state.view = { ...state.views[mode] };
    document.querySelectorAll('.view-btn').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.view === mode));
    });
    els.mapHint.textContent = MAP_HINTS[mode];
    showHover(-1);
    if (mode === 'web') wakeWeb(web.heat || first ? WEB_SETTLE_STEPS : 0);
    if (first) fit(paint.ids, true);
    drawMap();
    if (remember) {
      try {
        localStorage.setItem(VIEW_KEY, mode);
      } catch (error) {
        console.warn('Atlas: could not save the view', error);
      }
    }
  }

  /** The saved view (globe unless the web was picked before). */
  function readMode() {
    try {
      return localStorage.getItem(VIEW_KEY) === 'web' ? 'web' : 'globe';
    } catch {
      return 'globe';
    }
  }

  /* ==========================================================================
     07  ZOOM, PAN & 3D — buttons, wheel/trackpad, drag, and arrow keys (a
     non-drag alternative, WCAG 2.5.7). In 3D, dragging turns the map.
     ========================================================================== */
  /** 3D: spin the galaxy a little more around the screen's own axes, so it always follows the pointer
      and has no end stop in any direction. */
  function turnBy(yaw, tilt) {
    stopMove(); // turning by hand (or keys) takes over from a glide
    state.camera.rotation = straightened(multiply(turnMatrix(yaw, tilt), state.camera.rotation));
    drawSoon();
  }

  /** Slide the globe across the screen. It still turns around its own centre. */
  function panBy(dx, dy) {
    stopMove();
    state.view = { ...state.view, x: state.view.x + dx, y: state.view.y + dy };
    applyView();
  }

  /** Turn the globe so this point faces you, with north up. */
  function faceToward(point) {
    state.camera.rotation = facing(point);
  }

  /** The globe's turn that puts this point in front of you, with north up. */
  function facing(point) {
    const u = unit(point);
    return turnMatrix(Math.atan2(-u.x, -u.z), Math.atan2(-u.y, Math.hypot(u.x, u.z)));
  }

  /** Glide smoothly to a turn of the globe and a view (zoom and position): the shortest way round, easing in
      and out. Instant for people who asked for less motion, or when `instant` (opening the page). */
  function glideTo(rotation, view, instant = false) {
    stopMove();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (instant || reduce) {
      state.camera.rotation = rotation;
      state.view = view;
      drawMap();
      showSelectionCard();
      return;
    }
    const from = { turn: toQuaternion(state.camera.rotation), view: { ...state.view } };
    state.move = { from, to: { turn: toQuaternion(rotation), view }, start: performance.now(), frame: 0 };
    state.move.frame = requestAnimationFrame(stepMove);
  }

  /** One frame of a glide. */
  function stepMove(time) {
    const move = state.move;
    const t = Math.min(1, Math.max(0, (time - move.start) / GLIDE_TO_MS));
    const ease = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; // slow, fast, slow
    const { from, to } = move;
    state.camera.rotation = fromQuaternion(slerp(from.turn, to.turn, ease));
    const k = from.view.k * (to.view.k / from.view.k) ** ease; // zoom changes evenly, not in a rush
    state.view = {
      x: from.view.x + (to.view.x - from.view.x) * ease,
      y: from.view.y + (to.view.y - from.view.y) * ease,
      k,
    };
    drawMap();
    if (t < 1) {
      move.frame = requestAnimationFrame(stepMove);
      return;
    }
    state.move = null;
    showSelectionCard();
  }

  /** After gliding to something picked from a list: show its card (as pointing at it would), for keyboard users. */
  function showSelectionCard() {
    const id = state.cardAfterGlide;
    state.cardAfterGlide = null;
    if (!id || id !== state.selected) return;
    const i = paint.index.get(id);
    if (i === undefined || paint.bucket[i] === NO_BUCKET) return;
    paint.hover = -1;
    showHover(i);
  }

  /** Stop a glide where it is (a drag, zoom or new pick takes over). */
  function stopMove() {
    if (!state.move) return;
    cancelAnimationFrame(state.move.frame);
    state.move = null;
  }

  /** Keep coasting after letting go, slowing down (not for people who asked for less motion). */
  function startGlide({ yaw, tilt }) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    state.glide = { yaw, tilt, frame: requestAnimationFrame(stepGlide) };
  }

  /** One frame of coasting. */
  function stepGlide() {
    const glide = state.glide;
    glide.yaw *= GLIDE_DECAY;
    glide.tilt *= GLIDE_DECAY;
    if (Math.abs(glide.yaw) + Math.abs(glide.tilt) < GLIDE_STOP) return stopGlide();
    turnBy(glide.yaw, glide.tilt);
    glide.frame = requestAnimationFrame(stepGlide);
  }

  /** Stop coasting (a new drag takes over). */
  function stopGlide() {
    if (state.glide) cancelAnimationFrame(state.glide.frame);
    state.glide = null;
  }

  /** Remember the map's size, and give the canvas as many pixels. */
  function measureMap() {
    const { width, height } = els.graph.getBoundingClientRect();
    state.box = { width, height };
    sizeCanvas();
  }

  /** Keep the view centred when the window resizes or a phone rotates. */
  function followMapSize() {
    measureMap();
    new ResizeObserver(() => {
      const old = state.box;
      measureMap();
      if (old.width === state.box.width && old.height === state.box.height) return;
      const { x, y, k } = state.view;
      state.view = {
        x: x + (state.box.width - old.width) / 2,
        y: y + (state.box.height - old.height) / 2,
        k,
      };
      drawMap(); // straight away: resizing the canvas has just cleared it
    }).observe(els.graph);
  }

  /** The view (zoom and position) changed: draw it on the next frame. */
  function applyView() {
    drawSoon();
  }

  /** Zoom by `factor` around a point given in screen pixels (default: the centre), easing there smoothly. */
  function zoomBy(factor, px, py) {
    const box = els.graph.getBoundingClientRect();
    const anchor = { x: px === undefined ? box.width / 2 : px, y: py === undefined ? box.height / 2 : py };
    stopMove();
    const from = state.zoom ? state.zoom.target : state.view.k; // keep adding to a zoom that's still easing
    const target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, from * factor));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return zoomAround(target, anchor);
    const frame = state.zoom ? state.zoom.frame : requestAnimationFrame(stepZoom);
    state.zoom = { target, anchor, frame };
  }

  /** One frame of a smooth zoom: part of the way to the target, around the same point under the pointer. */
  function stepZoom() {
    const zoom = state.zoom;
    const k = state.view.k;
    const close = Math.abs(zoom.target - k) / zoom.target < 0.002;
    zoomAround(close ? zoom.target : k + (zoom.target - k) * ZOOM_EASE, zoom.anchor);
    if (close) {
      state.zoom = null;
      return;
    }
    zoom.frame = requestAnimationFrame(stepZoom);
  }

  /** Set the zoom to `k`, keeping the point at `anchor` (screen pixels in the map) where it is. */
  function zoomAround(k, anchor) {
    const ratio = k / state.view.k;
    state.view = {
      x: anchor.x - (anchor.x - state.view.x) * ratio,
      y: anchor.y - (anchor.y - state.view.y) * ratio,
      k,
    };
    applyView();
  }

  /** Stop a zoom that's still easing (fitting or selecting sets its own view). */
  function stopZoom() {
    if (!state.zoom) return;
    cancelAnimationFrame(state.zoom.frame);
    state.zoom = null;
  }

  /** Fit the whole globe into the map area, or turn a group of dust (an island) toward you and fit that. */
  function fit(ids = paint.ids, instant = false) {
    if (!ids.length) return;
    stopZoom();
    if (state.mode === 'web') return fitWeb(ids, instant);
    const whole = ids.length === paint.n;
    const rotation = whole ? state.camera.rotation : facing(middleOf(ids));
    const now = state.camera.rotation;
    state.camera.rotation = rotation; // measure where things will be once turned (put back below)
    // the whole map: measure the globe (the core is inside it)
    const measured = whole && SATELLITE ? ids.filter((id) => !paint.moon[paint.index.get(id)]) : ids;
    const points = measured.map(worldPoint).filter(Boolean).map(project);
    state.camera.rotation = now;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const box = els.graph.getBoundingClientRect();
    // The whole globe is measured from its centre, so it sits in the middle of the screen
    const span = (values) =>
      (whole ? 2 * Math.max(...values.map(Math.abs)) : Math.max(...values) - Math.min(...values)) || 1;
    const room = (size) => Math.max(40, size - FIT_MARGIN * 2); // the margin is in screen pixels: titles fit
    const fitted = Math.min(room(box.width) / span(xs), room(box.height) / span(ys));
    const k = Math.max(MIN_ZOOM, Math.min(2.5, fitted));
    const middle = (values) => (whole ? 0 : (Math.max(...values) + Math.min(...values)) / 2);
    glideTo(rotation, { x: box.width / 2 - middle(xs) * k, y: box.height / 2 - middle(ys) * k, k }, instant);
  }

  /** The average position of these nodes (where a group sits on the globe). */
  function middleOf(ids) {
    const points = ids.map(worldPoint).filter(Boolean);
    const sum = (axis) => points.reduce((total, point) => total + point[axis], 0);
    return { x: sum('x'), y: sum('y'), z: sum('z') };
  }

  /** Pointer down on the map: start a possible drag. */
  function startDrag(event) {
    stopGlide();
    stopMove();
    showHover(-1);
    state.drag = {
      x: event.clientX,
      y: event.clientY,
      view: { ...state.view },
      lastX: event.clientX,
      lastY: event.clientY,
      spin: null, // the latest bit of turning, to coast on after letting go
      moved: false,
      dot: -1, // web view: the dot being pulled
    };
    if (state.mode === 'web') {
      const i = nearestSpeck(event, HIT_PX);
      state.drag.dot = i < 0 ? -1 : web.of[i];
    }
    els.graph.setPointerCapture(event.pointerId);
  }

  /** Pointer move: turn once it has moved a few pixels (smaller wobbles still count as a click). With no
      button down, show what's under the pointer. */
  function moveDrag(event) {
    const drag = state.drag;
    if (!drag) return hoverAt(event);
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const [stepX, stepY] = [event.clientX - drag.lastX, event.clientY - drag.lastY];
    Object.assign(drag, { lastX: event.clientX, lastY: event.clientY });
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    els.graph.classList.add('is-panning');
    turnOrPan(drag, event, stepX, stepY);
  }

  /** Drag: turn the globe, or with Shift slide it. */
  function turnOrPan(drag, event, stepX, stepY) {
    if (state.mode === 'web') return pullOrPan(drag, event, stepX, stepY);
    if (event.shiftKey) return panBy(stepX, stepY);
    drag.spin = { yaw: stepX * TURN_SPEED, tilt: -stepY * TURN_SPEED, at: event.timeStamp };
    turnBy(drag.spin.yaw, drag.spin.tilt);
  }

  /** Web view drag: pull the dot under the pointer (the rest follow), or move the whole web. */
  function pullOrPan(drag, event, stepX, stepY) {
    if (drag.dot < 0) return panBy(stepX, stepY);
    const box = els.graph.getBoundingClientRect();
    const { x, y, k } = state.view;
    web.held = drag.dot;
    web.x[drag.dot] = (event.clientX - box.left - x) / k;
    web.y[drag.dot] = (event.clientY - box.top - y) / k;
    wakeWeb(WEB_DRAG_STEPS);
    drawSoon();
  }

  /** Pointer up (or cancelled): a click without movement selects the shape, or clears on the background;
      a spin that was still moving keeps coasting. */
  function endDrag(event) {
    const drag = state.drag;
    if (drag && !drag.moved && event.type === 'pointerup') {
      const i = nearestSpeck(event, HIT_PX);
      select(i < 0 ? null : paint.ids[i]);
    }
    if (drag && drag.spin && event.timeStamp - drag.spin.at < GLIDE_RECENT_MS) startGlide(drag.spin);
    state.drag = null;
    web.held = -1;
    els.graph.classList.remove('is-panning');
  }

  /** The index of the speck nearest the pointer, if one is within `reach` pixels (else -1: empty space).
      Dust facing you wins over dust on the far side at the same spot. */
  function nearestSpeck(event, reach) {
    const box = els.graph.getBoundingClientRect();
    const [px, py] = [event.clientX - box.left, event.clientY - box.top];
    const { sx, sy, depth, bucket } = paint;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < paint.n; i++) {
      if (bucket[i] === NO_BUCKET) continue;
      const distance = Math.hypot(sx[i] - px, sy[i] - py);
      if (distance > reach) continue;
      const score = distance + (depth[i] > 0 ? reach : 0); // the far side counts as a little farther away
      if (score < bestScore) [best, bestScore] = [i, score];
    }
    return best;
  }

  /** Pointing (no button down): ring and name the speck under the pointer. Not for touch: a tap selects. */
  function hoverAt(event) {
    if (event.pointerType === 'touch') return;
    const box = els.graph.getBoundingClientRect();
    state.pointer = { x: event.clientX - box.left, y: event.clientY - box.top }; // strands near it sway away
    if (strands.length && state.mode === 'globe') drawSoon();
    showHover(nearestSpeck(event, HOVER_PX));
  }

  /** Show what speck `i` is in the tooltip (or hide it for -1). */
  function showHover(i) {
    if (i === paint.hover) return;
    paint.hover = i;
    drawSoon();
    if (i < 0) {
      els.tooltip.hidden = true;
      return;
    }
    const node = nodeById.get(paint.ids[i]);
    els.tooltip.replaceChildren(
      el('strong', '', node.name),
      ...hoverFacts(node).map((fact) => el('span', '', fact)),
    );
    els.tooltip.hidden = false;
    const { width, height } = state.box;
    const [tipW, tipH] = [els.tooltip.offsetWidth, els.tooltip.offsetHeight];
    const x = Math.min(paint.sx[i] + 14, width - tipW - 8);
    const y = paint.sy[i] + 14 + tipH > height - 8 ? paint.sy[i] - 14 - tipH : paint.sy[i] + 14;
    els.tooltip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }

  /** "Claude: edited 12× · wrote 1×" for a file Claude has touched. */
  function claudeFact({ edits = 0, writes = 0 }) {
    const parts = [edits && `edited ${edits}×`, writes && `wrote ${writes}×`].filter(Boolean);
    return `Claude: ${parts.join(' · ')}`;
  }

  /** The short lines under a speck's name in the tooltip. */
  function hoverFacts(node) {
    const out = edgesOut.get(node.id) || [];
    const links = [...out, ...(edgesIn.get(node.id) || [])].filter((edge) =>
      LINK_KINDS.has(edge.kind),
    ).length;
    const plural = (count, word) => `${count.toLocaleString('en')} ${word}${count === 1 ? '' : 's'}`;
    let facts;
    if (node.type === 'folder') {
      const inside = out.filter((edge) => edge.kind === 'contains').map((edge) => nodeById.get(edge.target));
      const folders = inside.filter((kid) => kid && kid.type === 'folder').length;
      facts = ['folder', `${plural(inside.length - folders, 'file')} · ${plural(folders, 'subfolder')}`];
    } else if (node.type === 'file') {
      const parts = out.filter((edge) => edge.kind === 'declares' || edge.kind === 'styles').length;
      facts = [languageOf(node), `${plural(parts, 'code part')} · ${plural(links, 'link')}`];
    } else {
      facts = [`${typeInfo(node.type).label.replace(/es$|s$/, '')} · ${where(node)}`, plural(links, 'link')];
    }
    if (TOUCHES[node.id]) facts.push(claudeFact(TOUCHES[node.id]));
    if (healthOf.has(node.id)) facts.push(`possibly unused (${healthOf.get(node.id)})`);
    return facts;
  }

  /** Wheel / trackpad zooms around the pointer. */
  function handleWheel(event) {
    event.preventDefault();
    const box = els.graph.getBoundingClientRect();
    zoomBy(Math.exp(-event.deltaY * 0.0015), event.clientX - box.left, event.clientY - box.top);
  }

  /** Arrow keys pan (in 3D: turn; Shift+arrows pan), + / - zoom, 0 fits. ⌘/Ctrl combos stay the browser's. */
  function handleMapKeys(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const pan = PAN_KEYS[event.key];
    if (pan && state.mode === 'web') {
      panBy(pan[0] * PAN_STEP, pan[1] * PAN_STEP);
    } else if (pan && !event.shiftKey) {
      turnBy(pan[0] * TURN_STEP, -pan[1] * TURN_STEP);
    } else if (pan) {
      panBy(pan[0] * PAN_STEP, pan[1] * PAN_STEP);
    } else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
    else if (event.key === '-') zoomBy(1 / ZOOM_STEP);
    else if (event.key === '0') fit();
    else return;
    event.preventDefault();
  }

  /* ==========================================================================
     08  SELECTION & HIGHLIGHTING
     ========================================================================== */
  /** The selected node plus everything directly linked to it. */
  function nearSelection() {
    const near = new Set();
    if (!state.selected) return near;
    near.add(state.selected);
    (edgesOut.get(state.selected) || []).forEach((edge) => near.add(edge.target));
    (edgesIn.get(state.selected) || []).forEach((edge) => near.add(edge.source));
    return near;
  }

  /** Select a node (or null to clear): highlight it, show its details, announce it. */
  function select(id) {
    state.selected = id && nodeById.has(id) ? id : null;
    state.pick = null; // a selection (or clearing it) replaces a picked language or kind
    markPicked();
    highlight();
    renderDetails();
    if (state.selected) {
      const node = nodeById.get(state.selected);
      announce(`Selected ${node.name}: ${hoverFacts(node).join(', ')}.`); // the hover card's facts, spoken too
    } else {
      state.cardAfterGlide = null;
      showHover(-1);
    }
    rememberSelection();
  }

  /** Put the selected star in the address, so the page can be reopened on it. */
  function rememberSelection() {
    if (!state.selected && !location.hash) return;
    location.replace(`#star=${state.selected ? encodeURIComponent(state.selected) : ''}`);
  }

  /** Opened from an address with a star in it: go to that star. */
  function openLinkedStar() {
    const match = /^#star=(.+)$/.exec(location.hash);
    if (!match) return;
    try {
      const id = decodeURIComponent(match[1]);
      if (nodeById.has(id)) goTo(id);
    } catch {
      // A damaged address: just open the map
    }
  }

  /** Whether something is picked (a speck, a language or a kind of item), so everything else fades. */
  function isFocused() {
    return Boolean(state.selected || state.pick);
  }

  /** Fade everything except the selection and its neighbours, or a picked language's / kind's specks and
      whatever they're linked to (marked in paint.near), then redraw. */
  function highlight() {
    markHotLinks();
    paint.near.fill(0);
    paint.core.fill(0);
    const pick = state.pick;
    if (pick && pick.by === 'language') {
      const colour = COLOR_KEYS.indexOf(pick.key);
      for (let i = 0; i < paint.n; i++) {
        if (paint.color[i] !== colour) continue;
        paint.near[i] = 1;
        const type = nodeById.get(paint.ids[i]).type;
        if (type === 'file' || type === 'folder') paint.core[i] = 1; // name the files, not every function in them
      }
      for (let i = 0; i < paint.linkCount; i++) {
        if (paint.linkHot[i]) paint.near[paint.linkA[i]] = paint.near[paint.linkB[i]] = 1;
      }
    } else if (pick) {
      // the kind's items, and wherever they're declared or used (not what folders contain)
      const mark = (id) => paint.index.has(id) && (paint.near[paint.index.get(id)] = 1);
      DATA.nodes.forEach((node) => {
        if (node.type !== pick.key || !mark(node.id)) return;
        paint.core[paint.index.get(node.id)] = 1;
      });
      DATA.edges.forEach((edge) => {
        if (edge.kind === 'contains') return;
        const [from, to] = [nodeById.get(edge.source), nodeById.get(edge.target)];
        if (from && from.type === pick.key) mark(edge.target);
        if (to && to.type === pick.key) mark(edge.source);
      });
    } else {
      nearSelection().forEach((id) => {
        const i = paint.index.get(id);
        if (i !== undefined) paint.near[i] = 1;
      });
    }
    drawSoon();
  }

  /** Pick a language (colour key) or a kind of item (numbers panel): show where it's used, and turn the
      globe toward it. Picking the same one again clears it. */
  function pick(by, key) {
    const same = state.pick && state.pick.by === by && state.pick.key === key;
    select(null); // clears a selected speck (and any pick)
    state.pick = same ? null : { by, key };
    markPicked();
    highlight();
    if (same) return announce('Showing everything.');
    let [items, links] = [0, 0];
    const colour = COLOR_KEYS.indexOf(key);
    const type = key === 'folder' ? 'folder' : 'file';
    DATA.nodes.forEach((node, i) => {
      const counted = by === 'language' ? paint.color[i] === colour && node.type === type : node.type === key;
      items += counted ? 1 : 0;
    });
    paint.linkHot.forEach((hot) => (links += hot));
    const name = by === 'language' ? `${key} ${type}s` : typeInfo(key).label;
    announce(`Showing ${items.toLocaleString('en')} ${name} and ${links} links.`);
    fit(paint.ids.filter((_, i) => paint.near[i])); // glide round until they face you
  }

  /** Show which language (colour key) or kind (numbers panel) is picked. */
  function markPicked() {
    document.querySelectorAll('[data-pick]').forEach((button) => {
      const on = Boolean(state.pick) && button.dataset.pick === `${state.pick.by}:${state.pick.key}`;
      button.setAttribute('aria-pressed', String(on));
    });
  }

  /** Select from a list (search, details, health) and bring the node into view. */
  function goTo(id) {
    stopZoom();
    select(id);
    state.cardAfterGlide = id; // picked from a list (keyboard friendly): show its card once it's in view
    const box = els.graph.getBoundingClientRect();
    if (state.mode === 'web') {
      const dot = webDotFor(id);
      if (dot < 0) return;
      const k = state.view.k;
      glideTo(state.camera.rotation, {
        x: box.width / 2 - web.x[dot] * k,
        y: box.height / 2 - web.y[dot] * k,
        k,
      });
      return;
    }
    const point = worldPoint(id);
    if (!point) return;
    // the globe glides round (on its own centre) until this faces you, in the middle of the screen
    glideTo(facing(point), { x: box.width / 2, y: box.height / 2, k: state.view.k });
    if (!window.matchMedia('(width >= 1000px)').matches) els.graph.scrollIntoView({ block: 'nearest' });
  }

  /* ==========================================================================
     09  NUMBERS PANEL — counts, then health (section 10); hidden at first (the top bar's # button shows it)
     ========================================================================== */
  /** How many folders, files and pieces of code there are, and how many links. */
  function renderDetails() {
    els.detailsTitle.textContent = 'numbers';
    if (!DATA.nodes.length) {
      els.detailsBody.replaceChildren(
        el('p', 'empty-note', 'No graph data. Open the graph.html made by atlas.py build.'),
      );
      return;
    }
    const rows = TYPES.map(({ type, label }) => [
      label,
      DATA.nodes.filter((node) => node.type === type).length,
      type,
    ]);
    if (PROJECTS.length) rows.unshift(['projects', PROJECTS.length, null]);
    rows.push(['links in total', DATA.edges.length, null]);
    const stats = el('dl', 'overview-stats');
    rows.forEach(([label, count, type]) => {
      const box = el('div');
      const term = el('dt', '', type && count ? '' : label);
      if (type && count) {
        // a kind of item (functions, html ids…): the whole card is a button that shows them and what uses them
        box.className = 'stat-pickable';
        term.append(statButton(label, type));
      }
      box.append(term, el('dd', '', count.toLocaleString('en')));
      stats.append(box);
    });
    els.detailsBody.replaceChildren(stats);
    markPicked();
  }

  /** The button for a kind of item in the numbers panel (its clickable area covers the whole card, via CSS). */
  function statButton(label, type) {
    const button = el('button', 'stat-btn', label);
    button.type = 'button';
    button.dataset.pick = `type:${type}`;
    button.setAttribute('aria-pressed', 'false');
    button.title = `Show the ${label} and what uses them`;
    button.addEventListener('click', () => pick('type', type));
    return button;
  }

  /** Show or hide the panel on the right (search, folders, numbers and health). */
  function toggleNumbers(open = els.details.hidden) {
    togglePanel(els.details, els.numbersBtn, 'has-numbers', 'Search, folders, numbers and health', open);
  }

  /** Show or hide a side panel, with its button and the layout's column for it. */
  function togglePanel(panel, button, className, name, open = panel.hidden) {
    if (open !== panel.hidden) return; // already as asked
    panel.hidden = !open;
    els.layout.classList.toggle(className, open);
    button.setAttribute('aria-expanded', String(open));
    announce(`${name} ${open ? 'shown' : 'hidden'}.`);
  }

  /* ==========================================================================
     10  LISTS & HEALTH
     ========================================================================== */
  /** A clickable row for one node (search results and health lists): it goes to that speck. */
  function nodeRow(id) {
    const node = nodeById.get(id);
    const item = el('li');
    const button = el('button', 'node-link');
    button.type = 'button';
    button.append(
      shapeIcon(node),
      el('span', 'node-name', node.name),
      el('span', 'node-where', shortWhere(node)),
    );
    button.addEventListener('click', () => goTo(id));
    item.append(button);
    return item;
  }

  /** The health checks as collapsible lists (or a ✓ when all is well). */
  function renderHealth() {
    const groups = Object.entries(DATA.health || {}).filter(([, ids]) => ids.length);
    if (!groups.length) {
      els.healthList.replaceChildren(el('p', 'health-ok', '✓ nothing found'));
      return;
    }
    els.healthList.replaceChildren(
      ...groups.map(([check, ids]) => {
        const details = el('details', 'health-group');
        const summary = el('summary', '', `${HEALTH_TITLES[check]} `);
        summary.append(el('span', 'health-count', `(${ids.length})`));
        const list = el('ul', 'health-items');
        ids.forEach((id) => list.append(nodeRow(id)));
        details.append(summary, list);
        return details;
      }),
    );
  }

  /* ==========================================================================
     11  SEARCH — exact name first, then names starting with the text, then containing it
     ========================================================================== */
  /** Matching nodes for the search text (at most 30). */
  function searchNodes(text) {
    const query = text.trim().toLowerCase();
    if (!query) return [];
    const score = (node) => {
      const name = node.name.toLowerCase();
      const short = name.split('/').pop();
      if (name === query || short === query) return 0;
      if (short.startsWith(query) || name.startsWith(query)) return 1;
      return name.includes(query) ? 2 : 3;
    };
    return DATA.nodes
      .map((node) => [score(node), node])
      .filter(([s]) => s < 3)
      .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
      .slice(0, 30)
      .map(([, node]) => node);
  }

  /** Show the results list as the user types. */
  function handleSearch() {
    const found = searchNodes(els.searchInput.value);
    els.searchResults.replaceChildren(...found.map((node) => nodeRow(node.id)));
    els.searchResults.hidden = !els.searchInput.value.trim();
    const matches = `${found.length} ${found.length === 1 ? 'match' : 'matches'}`;
    els.searchStatus.textContent = els.searchInput.value.trim() ? matches : '';
    if (els.searchInput.value.trim() && !found.length) {
      els.searchResults.replaceChildren(el('li', 'empty-note', 'no matches'));
    }
  }

  /** Enter selects the best match; Escape clears the search. */
  function handleSearchKeys(event) {
    if (event.key === 'Enter') {
      const [best] = searchNodes(els.searchInput.value);
      if (best) goTo(best.id);
    } else if (event.key === 'Escape') {
      els.searchInput.value = '';
      handleSearch();
    }
  }

  /* ==========================================================================
     12  FOLDER TREE — every folder with the files inside it (subfolders fold
     open). Clicking a folder or file turns the globe until it faces you.
     ========================================================================== */
  /** The panel's folder tree: every folder closed at first; clicking one shows the files inside it. */
  function buildTree() {
    const children = childrenByFolder();
    const roots = treeRoots(children);
    if (!roots.length) {
      els.tree.replaceChildren(el('p', 'empty-note', 'No folders in this map.'));
      return;
    }
    els.tree.replaceChildren(...roots.map((root) => treeItem(root, children, false))); // all closed at first
  }

  /** One folder (a fold-open list of what's inside it), or one file (a button). */
  function treeItem(node, children, open) {
    if (!children.has(node.id)) return treeButton(node);
    const folder = el('details', 'tree-folder');
    folder.open = open;
    const summary = el('summary', 'tree-summary');
    summary.append(shapeIcon(node), el('span', 'node-name', baseName(node.name)));
    summary.append(el('span', 'node-where', String(children.get(node.id).length)));
    summary.title = node.name;
    summary.addEventListener('click', () => goTo(node.id)); // it still folds open or shut as usual
    const list = el('ul', 'tree-list');
    children.get(node.id).forEach((kid) => {
      const item = el('li');
      item.append(treeItem(kid, children, false));
      list.append(item);
    });
    folder.append(summary, list);
    return folder;
  }

  /** A file in the tree: its name; clicking it turns the globe to it. */
  function treeButton(node) {
    const button = el('button', 'node-link tree-file');
    button.type = 'button';
    button.title = node.name;
    button.append(shapeIcon(node), el('span', 'node-name', baseName(node.name)));
    button.addEventListener('click', () => goTo(node.id));
    return button;
  }

  /** The last part of a path: "assets/js/app.js" → "app.js". */
  function baseName(path) {
    return path.split('/').pop();
  }

  /* ==========================================================================
     13  THEME, HELP & ANNOUNCEMENTS
     ========================================================================== */
  /** Apply a theme (auto follows the system). */
  function applyTheme(theme) {
    state.theme = theme;
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    const icon = svgEl('svg', { class: 'icon', 'aria-hidden': 'true', focusable: 'false' });
    icon.append(svgEl('use', { href: `#i-theme-${theme}` }));
    els.themeBtn.replaceChildren(icon);
    els.themeBtn.setAttribute('aria-label', `Theme: ${theme}. Switch to ${next}`);
    const bar = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
    els.themeColor.setAttribute('content', bar); // the phone browser's bar matches the page
  }

  /** Theme button: next theme, remembered when storage is available. */
  function cycleTheme() {
    const theme = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      console.warn('Atlas: could not save the theme', error);
    }
  }

  /** The saved theme, or "auto". */
  function readTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return THEMES.includes(saved) ? saved : 'auto';
    } catch {
      return 'auto';
    }
  }

  /** Read a short message to screen-reader users. */
  function announce(message) {
    els.announcer.textContent = '';
    setTimeout(() => {
      els.announcer.textContent = message;
    }, 50);
  }

  /* ==========================================================================
     14  KEYBOARD SHORTCUTS — / search · Esc clear · ? help
     ========================================================================== */
  /** Global shortcuts (ignored while typing or when the help is open). */
  function handleShortcuts(event) {
    if (els.helpDialog.open || event.target === els.searchInput) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return; // leave browser shortcuts alone
    if (event.key === '/') {
      event.preventDefault();
      toggleNumbers(true); // the search box is at the top of the panel
      els.searchInput.focus();
    } else if (event.key === '?') {
      event.preventDefault();
      els.helpDialog.showModal();
    } else if (event.key === 'v' || event.key === 'V') {
      setMode(state.mode === 'globe' ? 'web' : 'globe');
      announce(`${state.mode === 'web' ? 'Web' : 'Globe'} view.`);
    } else if (event.key === 's' || event.key === 'S') {
      setSpin(!state.spinning);
      announce(`Spin ${state.spinning ? 'on' : 'off'}.`);
    } else if (event.key === 'Escape' && isFocused()) {
      select(null);
    }
  }

  /* ==========================================================================
     15  INIT
     ========================================================================== */
  /** The map: drag, wheel, keys, and the zoom / fit buttons. */
  function bindMap() {
    els.graph.addEventListener('pointerdown', startDrag);
    els.graph.addEventListener('pointermove', moveDrag);
    els.graph.addEventListener('pointerup', endDrag);
    els.graph.addEventListener('pointercancel', endDrag);
    els.graph.addEventListener('pointerleave', () => {
      showHover(-1);
      state.pointer = null; // the strands ease back
      drawSoon();
    });
    els.graph.addEventListener('wheel', handleWheel, { passive: false });
    els.graph.addEventListener('keydown', handleMapKeys);
    els.zoomInBtn.addEventListener('click', () => zoomBy(ZOOM_STEP));
    els.zoomOutBtn.addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
    els.fitBtn.addEventListener('click', () => fit());
  }

  /** Wire every control. */
  function bindEvents() {
    bindMap();
    els.searchInput.addEventListener('input', handleSearch);
    els.searchInput.addEventListener('keydown', handleSearchKeys);
    els.helpBtn.addEventListener('click', () => els.helpDialog.showModal());
    els.helpDialog.addEventListener('click', (event) => {
      if (event.target === els.helpDialog || event.target.closest('[data-close]')) els.helpDialog.close();
    });
    els.themeBtn.addEventListener('click', cycleTheme);
    els.numbersBtn.addEventListener('click', () => toggleNumbers());
    els.spinBtn.addEventListener('click', () => setSpin(!state.spinning));
    document.querySelectorAll('.view-btn').forEach((button) => {
      button.addEventListener('click', () => setMode(button.dataset.view));
    });
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => applyTheme(state.theme));
    document.addEventListener('keydown', handleShortcuts);
  }

  /** Start: theme, project name, folder tree, layout, numbers, health. */
  function init() {
    applyTheme(readTheme());
    const project = (DATA.meta && DATA.meta.project) || 'project';
    els.projectName.textContent = project;
    document.title = `${project} — Atlas code map`;
    buildTree();
    bindEvents();
    makeStars();
    const [biggest] = layoutGlobe();
    if (biggest) faceToward(state.positions.get(biggest.id)); // start facing the biggest project (no glide)
    makeGrid();
    setUpCanvas();
    makeLinks();
    followMapSize();
    redraw();
    fit(paint.ids, true); // opening the page: no glide
    renderLegend();
    setSpin(readSpin(), false);
    setMode(readMode(), false);
    renderDetails();
    renderHealth();
    openLinkedStar();
  }

  init();
})();
