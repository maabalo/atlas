/* ==========================================================================
   Atlas — app.js (viewer)
   --------------------------------------------------------------------------
   Reads the graph from <script id="graphData"> (inlined by atlas.py build),
   lays it out with a small force simulation (no libraries), draws it as SVG
   in 2D or 3D (perspective, drawn by this file), and lets you search, filter,
   zoom, pan, turn and inspect it.

   TABLE OF CONTENTS
     01  Settings
     02  Data & indexes
     03  DOM references & small helpers
     04  State & filters
     05  Layout (force simulation)
     06  Drawing the map
     07  Zoom, pan & 3D
     08  Selection & highlighting
     09  Details panel
     10  Overview & health
     11  Search
     12  Filter checkboxes & islands
     13  Theme, help & announcements
     14  Keyboard shortcuts
     15  Init
   ========================================================================== */
(function () {
  'use strict';

  /* ==========================================================================
     01  SETTINGS
     ========================================================================== */
  const THEME_KEY = 'atlas-theme'; // also read by the inline script in index.html
  const THEMES = ['auto', 'light', 'dark'];
  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** Node types: label, kind of star, and whether they're shown at first (ids/classes can be busy). */
  const TYPES = [
    { type: 'file', label: 'files', star: 'giant', on: true },
    { type: 'function', label: 'functions', star: 'sun', on: true },
    { type: 'class', label: 'classes', star: 'binary', on: true },
    { type: 'html-id', label: 'html ids', star: 'pulsar', on: false },
    { type: 'css-class', label: 'css classes', star: 'ring', on: false },
  ];
  /** The circles of each kind of star: [part, sideways offset, radius], both × the star's size. */
  const STAR_PARTS = {
    giant: [
      ['halo', 0, 1.5],
      ['body', 0, 1],
      ['core', 0, 0.45],
    ],
    sun: [
      ['body', 0, 1],
      ['core', 0, 0.4],
    ],
    binary: [
      ['body', -0.6, 0.62],
      ['core', -0.6, 0.28],
      ['body', 0.6, 0.62],
      ['core', 0.6, 0.28],
    ],
    pulsar: [
      ['orbit', 0, 1],
      ['body', 0, 0.5],
      ['core', 0, 0.22],
    ],
    ring: [['ring', 0, 0.85]],
  };
  const LINK_WORDS = {
    out: {
      calls: 'calls',
      uses: 'uses',
      imports: 'imports',
      loads: 'loads',
      declares: 'defines',
      styles: 'styles',
    },
    in: {
      calls: 'called by',
      uses: 'used by',
      imports: 'imported by',
      loads: 'loaded by',
      declares: 'defined in',
      styles: 'styled by',
    },
  };
  const HEALTH_TITLES = {
    unused_functions: 'unused functions',
    unused_css_classes: 'unused css classes',
    missing_ids: 'missing ids',
  };
  // Layout & drawing
  const REPULSION = 2400; // how strongly nodes push apart
  const SPRING = 0.04; // how strongly links pull together
  const GRAVITY = 0.012; // pull toward the middle, so islands don't drift away
  const LINK_LENGTH = { declares: 38, styles: 70, default: 90 };
  const ISLAND_SIZE = 45; // combined maps: room per project, × √(its number of nodes)
  const HUB_LABEL_DEGREE = 6;
  const GLOW_PX = 2.5; // how far each dot's glow spreads, in screen pixels
  const MIN_ZOOM = 0.05; // far enough out for a combined map of many projects
  const FIT_MARGIN = 56; // px kept free around the map when fitting (room for names and project titles)
  const STAR_COUNT = 900; // stars all around the sky (in 3D, about a quarter are in view at once)
  const FLAT_STAR_COUNT = 260; // how many the flat 2D map shows
  const SKY_REACH = 0.55; // how far the sky spreads, × the map's diagonal (just past its corners)
  const STAR_SEED = 20261108; // the same sky every time
  const NEBULA_COLORS = ['violet', 'teal', 'rose', 'blue', 'violet', 'rose', 'teal']; // one cloud each
  const NEBULA_PUFFS = 9; // overlapping soft ellipses per cloud, so it isn't a plain oval
  const NEBULA_MIN_LOOSE = 3; // clouds not tied to an island (more on maps with few islands)
  const NEBULA_SEED = 7281;
  // The spiral galaxy (3D)
  const DISC_SPREAD = 1.5; // how wide the arms reach, × the ring the 2D islands sit on
  const ARM_SWEEP = 2.6; // radians each arm curves from the centre to the rim
  const SWIRL = 2.2; // how much more the middle is twisted than the rim (radians)
  const PULL = 1.35; // above 1 draws everything toward the core
  const FLATTEN = 0.35; // the galaxy's thickness compared with its width
  const DUST_COUNT = 1100; // tiny stars tracing the arms
  const MAX_LIST = 150; // longest list drawn in the details panel
  const ZOOM_STEP = 1.25;
  const PAN_STEP = 60;
  // 3D
  const DEPTH_SPREAD = 300; // how deep nodes start when switching to 3D
  const TURN_SPEED = 0.008; // radians per pixel dragged
  const TURN_STEP = 0.15; // radians per arrow key
  const GLIDE_DECAY = 0.94; // after letting go, the spin keeps this share of its speed each frame
  const GLIDE_STOP = 0.0004; // radians per frame: slow enough to stop
  const IDLE_SPEED = 0.012; // radians per second the galaxy turns by itself: about 9 minutes per turn
  const IDLE_FRAME_MS = 66; // redraw about 15 times a second: plenty at this speed, and easy on the computer
  const IDLE_RESUME_MS = 1500; // wait this long after the last touch before drifting again
  const IDLE_SORT_MS = 4000; // how often to re-layer the stars while drifting
  const LESS_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
  const GLIDE_RECENT_MS = 80; // only glide if the pointer was still moving when it let go
  const HINTS = {
    '2d': 'drag to pan · scroll or +/− to zoom · click a star',
    '3d': 'drag to turn · shift+drag to pan · scroll to zoom · click a star',
  };
  /** Arrow key → direction the map content moves (x, y). */
  const PAN_KEYS = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

  /* ==========================================================================
     02  DATA & INDEXES
     ========================================================================== */
  const DATA = readData();
  const nodeById = new Map(DATA.nodes.map((node) => [node.id, node]));
  const edgesOut = groupBy(DATA.edges, 'source');
  const edgesIn = groupBy(DATA.edges, 'target');
  const degree = countDegrees(DATA.edges);
  const healthOf = healthIndex(DATA.health || {});
  const HOMES = projectHomes(); // combined maps: where each project's island sits
  const COMMUNITIES = DATA.meta.communities || []; // subsystems, biggest first: {id, name, size, hub}

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

  /** The project a node belongs to in a combined map ("" for a single project). */
  function projectOf(node) {
    return DATA.meta.projects ? node.file.split('/')[0] : '';
  }

  /** Combined maps: each project's home, around a circle, with room in proportion to its size
      (and, for 3D, along two spiral arms, biggest nearest the centre).
      Nodes are pulled to their own project's home, so projects form separate islands. */
  function projectHomes() {
    const homes = new Map();
    const projects = DATA.meta.projects || [];
    if (projects.length < 2) return homes;
    const sizes = projects.map((project) => {
      const count = DATA.nodes.filter((node) => projectOf(node) === project).length;
      return ISLAND_SIZE * Math.sqrt(count);
    });
    const total = sizes.reduce((sum, size) => sum + size, 0);
    const radius = (total / (2 * Math.PI)) * 1.2;
    const bySize = [...projects.keys()].sort((a, b) => sizes[b] - sizes[a]);
    let around = 0;
    projects.forEach((project, i) => {
      const angle = ((around + sizes[i] / 2) / total) * Math.PI * 2;
      homes.set(project, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        disc: discHome(bySize.indexOf(i), projects.length, radius),
      });
      around += sizes[i];
    });
    return homes;
  }

  /** Where the island of this size rank sits on the arms (the arms take turns). */
  function discHome(rank, count, radius) {
    return spiralPoint(0.2 + (0.8 * (rank + 0.5)) / count, rank % 2, radius * DISC_SPREAD);
  }

  /** A place on spiral arm 0 or 1, at `t` of the way out (0 = centre, 1 = the rim), in the galaxy's flat disc. */
  function spiralPoint(t, arm, radius) {
    const angle = arm * Math.PI - ARM_SWEEP * t;
    return { x: Math.cos(angle) * t * radius, y: 0, z: Math.sin(angle) * t * radius, t };
  }

  /** Where a node's gravity pulls: its project's home (on the spiral arms in 3D), or the middle. */
  function homeOf(node) {
    const home = HOMES.get(projectOf(node));
    if (!home) return { x: 0, y: 0, z: 0 };
    return state.mode === '3d' ? home.disc : { x: home.x, y: home.y, z: 0 };
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

  /** Links per node (calls/uses/imports/loads), which sets its size and "hub" status. */
  function countDegrees(edges) {
    const counts = new Map();
    edges
      .filter((edge) => edge.kind !== 'declares' && edge.kind !== 'styles')
      .forEach((edge) => {
        counts.set(edge.source, (counts.get(edge.source) || 0) + 1);
        counts.set(edge.target, (counts.get(edge.target) || 0) + 1);
      });
    return counts;
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
    typeFilters: byId('typeFilters'),
    islandPanel: byId('islandPanel'),
    islandCount: byId('islandCount'),
    islandList: byId('islandList'),
    islandToggle: byId('islandToggle'),
    nebulaLayer: byId('nebulaLayer'),
    mapEmpty: byId('mapEmpty'),
    themeColor: byId('themeColor'),
    inferredToggle: byId('inferredToggle'),
    labelsToggle: byId('labelsToggle'),
    communityToggle: byId('communityToggle'),
    glowBlur: byId('glowBlur'),
    starLayer: byId('starLayer'),
    healthList: byId('healthList'),
    graph: byId('graph'),
    viewport: byId('viewport'),
    edgeLayer: byId('edgeLayer'),
    nodeLayer: byId('nodeLayer'),
    labelLayer: byId('labelLayer'),
    zoomInBtn: byId('zoomInBtn'),
    zoomOutBtn: byId('zoomOutBtn'),
    fitBtn: byId('fitBtn'),
    depthBtn: byId('depthBtn'),
    mapHint: byId('mapHint'),
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
    shownTypes: new Set(TYPES.filter((entry) => entry.on).map((entry) => entry.type)),
    hiddenProjects: new Set(), // combined maps: islands switched off in the Islands panel
    showInferred: true,
    showLabels: false, // file, hub and project names (the selection is always named)
    byCommunity: false, // colour dots by community instead of by type
    positions: new Map(), // node id → {x, y, z}, kept between layouts so the map stays stable
    view: { x: 0, y: 0, k: 1 },
    mode: '3d', // or '2d' (3D is the default)
    camera: { rotation: turnMatrix(0.5, -1.05), distance: 1200 }, // 3D: how the galaxy is turned, then perspective
    galaxyRadius: 0, // 3D: the size the swirl is measured against (set once, so hiding things doesn't reshape it)
    pivot: { x: 0, y: 0, z: 0 }, // 3D: the point the galaxy turns around, always at the middle of the screen
    glide: null, // 3D: the spin still coasting after letting go
    idle: { last: 0, sorted: 0, active: false, pausedUntil: 0 }, // 3D: the slow turn when nothing is touching it
    sky: [], // background stars: {dot, x, y (% for 2D), dir (direction in 3D)}
    box: { width: 0, height: 0 }, // the map's size on screen, measured when it changes (not every frame)
    screen: new Map(), // node id → where it's drawn now: {x, y, s (size), depth}
    frame: 0, // a pending requestAnimationFrame (3D turning)
    switched: false, // during the layout right after a 2D/3D switch
    selected: null,
    drag: null, // the pointer gesture in progress (section 07)
    drawn: { nodes: new Map(), edges: [], labels: new Map(), islands: new Map(), clouds: [], dust: [] },
  };

  /** Whether a node's type and island are both switched on. */
  function nodeShown(node) {
    return state.shownTypes.has(node.type) && !state.hiddenProjects.has(projectOf(node));
  }

  /** Nodes that are switched on. */
  function visibleNodes() {
    return DATA.nodes.filter(nodeShown);
  }

  /** Edges between two visible nodes (inferred ones only when that box is ticked). */
  function visibleEdges(shown) {
    return DATA.edges.filter((edge) => shown.has(edge.source) && shown.has(edge.target) && edgeShown(edge));
  }

  /* ==========================================================================
     05  LAYOUT — a small force simulation: nodes repel, links pull,
     gravity keeps it centred. Runs once per filter change (not animated).
     ========================================================================== */
  /** Positions for the given nodes (existing positions are reused as starting points). */
  function layout(nodes, edges) {
    const sim = startPositions(nodes);
    const links = springLinks(nodes, edges);
    const ticks = Math.max(60, Math.min(300, Math.round(4e7 / (nodes.length * nodes.length + 1))));
    for (let tick = 0; tick < ticks; tick++) {
      const alpha = 1 - tick / ticks;
      applyRepulsion(sim, alpha);
      applySprings(sim, links, alpha);
      integrate(sim, alpha);
    }
    nodes.forEach((node, i) => state.positions.set(node.id, { x: sim.x[i], y: sim.y[i], z: sim.z[i] }));
  }

  /** Typed arrays for x/y/velocity; new nodes start near their file (deterministically). */
  function startPositions(nodes) {
    const n = nodes.length;
    const sim = {
      n,
      x: new Float64Array(n),
      y: new Float64Array(n),
      z: new Float64Array(n), // depth: stays 0 in 2D
      vx: new Float64Array(n),
      vy: new Float64Array(n),
      vz: new Float64Array(n),
      homeX: new Float64Array(n), // where gravity pulls each node (its project's island)
      homeY: new Float64Array(n),
      homeZ: new Float64Array(n),
    };
    nodes.forEach((node, i) => startNode(sim, node, i));
    return sim;
  }

  /** One node's start: near its last position (or its file's), else near its project's home. */
  function startNode(sim, node, i) {
    const known = state.positions.get(node.id) || state.positions.get(`file:${node.file}`);
    const home = homeOf(node);
    const from = known && !state.switched ? known : home; // a new 2D/3D layout starts from the homes
    const angle = hash(node.id) * Math.PI * 2;
    const spread = (known ? 40 : 300) * (0.3 + hash(node.id + 'r'));
    sim.x[i] = from.x + Math.cos(angle) * spread;
    sim.y[i] = from.y + Math.sin(angle) * spread;
    sim.z[i] = state.mode === '3d' ? startDepth(node, known, home) : 0;
    sim.homeX[i] = home.x;
    sim.homeY[i] = home.y;
    sim.homeZ[i] = home.z;
  }

  /** 3D: keep a known depth; otherwise spread nodes out in depth around their home (deterministically). */
  function startDepth(node, known, home) {
    if (known && known.z && !state.switched) return known.z;
    return home.z + (hash(node.id + 'z') - 0.5) * 2 * DEPTH_SPREAD;
  }

  /** A stable pseudo-random number in [0, 1) from a string (same map every time). */
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return ((h >>> 0) % 10000) / 10000;
  }

  /** The links as springs. Like d3's force layout, each spring is weakened by its ends' link counts
      (1 / the smaller count) and moves the busier end less: otherwise a hub's many springs add up,
      overshoot every tick and the layout flies apart (one real project's `el` helper had 65 links). */
  function springLinks(nodes, edges) {
    const index = new Map(nodes.map((node, i) => [node.id, i]));
    const pairs = edges.map((edge) => [index.get(edge.source), index.get(edge.target), linkLength(edge)]);
    const count = new Float64Array(nodes.length);
    pairs.forEach(([a, b]) => {
      count[a] += 1;
      count[b] += 1;
    });
    return pairs.map(([a, b, length]) => ({
      a,
      b,
      length,
      strength: SPRING / Math.min(count[a], count[b]),
      bias: count[a] / (count[a] + count[b]), // the share of the pull that moves b
    }));
  }

  /** Resting length of a link: definitions sit close to their file. */
  function linkLength(edge) {
    return LINK_LENGTH[edge.kind] || LINK_LENGTH.default;
  }

  /** Every pair of nodes pushes apart (strength falls with distance²). */
  function applyRepulsion(sim, alpha) {
    for (let i = 0; i < sim.n; i++) {
      for (let j = i + 1; j < sim.n; j++) {
        const dx = sim.x[j] - sim.x[i] || 0.01;
        const dy = sim.y[j] - sim.y[i] || 0.01;
        const dz = sim.z[j] - sim.z[i]; // 0 in 2D
        const force = ((REPULSION * alpha) / Math.max(dx * dx + dy * dy + dz * dz, 25)) * 0.05;
        sim.vx[i] -= dx * force;
        sim.vy[i] -= dy * force;
        sim.vz[i] -= dz * force;
        sim.vx[j] += dx * force;
        sim.vy[j] += dy * force;
        sim.vz[j] += dz * force;
      }
    }
  }

  /** Each link pulls its two ends toward its resting length (the busier end moves less). */
  function applySprings(sim, links, alpha) {
    links.forEach(({ a, b, length, strength, bias }) => {
      const dx = sim.x[b] - sim.x[a];
      const dy = sim.y[b] - sim.y[a];
      const dz = sim.z[b] - sim.z[a];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const pull = ((distance - length) / distance) * strength * alpha * 2; // × 2: both ends' share
      sim.vx[a] += dx * pull * (1 - bias);
      sim.vy[a] += dy * pull * (1 - bias);
      sim.vz[a] += dz * pull * (1 - bias);
      sim.vx[b] -= dx * pull * bias;
      sim.vy[b] -= dy * pull * bias;
      sim.vz[b] -= dz * pull * bias;
    });
  }

  /** Gravity toward each node's home (the middle, or its project's island), friction, then move. */
  function integrate(sim, alpha) {
    for (let i = 0; i < sim.n; i++) {
      sim.vx[i] = (sim.vx[i] - (sim.x[i] - sim.homeX[i]) * GRAVITY * alpha) * 0.6;
      sim.vy[i] = (sim.vy[i] - (sim.y[i] - sim.homeY[i]) * GRAVITY * alpha) * 0.6;
      sim.vz[i] = (sim.vz[i] - (sim.z[i] - sim.homeZ[i]) * GRAVITY * alpha) * 0.6;
      sim.x[i] += sim.vx[i];
      sim.y[i] += sim.vy[i];
      sim.z[i] += sim.vz[i];
    }
  }

  /* ==========================================================================
     06  DRAWING THE MAP
     ========================================================================== */
  /** Re-layout and redraw everything for the current filters. */
  function redraw() {
    const nodes = visibleNodes();
    const shown = new Set(nodes.map((node) => node.id));
    const edges = visibleEdges(shown);
    layout(nodes, edges);
    state.camera.distance = cameraDistance(nodes);
    state.galaxyRadius = state.galaxyRadius || state.camera.distance / 3;
    drawEdges(edges);
    drawNodes(nodes);
    drawLabels();
    place();
    els.mapEmpty.hidden = nodes.length > 0;
    if (state.selected && !shown.has(state.selected)) state.selected = null;
    highlight();
  }

  /** One <line> per visible edge (place() puts its ends where its nodes are drawn). */
  function drawEdges(edges) {
    state.drawn.edges = edges.map((edge) => {
      const extra = edge.certainty === 'inferred' ? ' edge--inferred' : '';
      const line = svgEl('line', { class: `edge edge--${edge.kind}${extra}` });
      return { edge, line };
    });
    els.edgeLayer.replaceChildren(...state.drawn.edges.map((item) => item.line));
  }

  /** One shape per visible node, drawn around (0, 0) (place() moves it); it grows with its links. */
  function drawNodes(nodes) {
    state.drawn.nodes = new Map();
    const shapes = nodes.map((node) => {
      const radius = node.type === 'file' ? 9 : 4 + Math.min(10, Math.sqrt(degree.get(node.id) || 0) * 1.6);
      const shape = starElement(typeInfo(node.type).star, 0, 0, radius);
      shape.setAttribute('class', `node node--${node.type}`);
      shape.style.setProperty('--community', communityColor(node.community));
      shape.dataset.id = node.id;
      const title = svgEl('title'); // pointing at a star shows its name (handy while labels are hidden)
      title.textContent = node.name;
      shape.append(title);
      state.drawn.nodes.set(node.id, shape);
      return shape;
    });
    els.nodeLayer.replaceChildren(...shapes);
  }

  /** A community's colour: hues spread by the golden angle so neighbours differ; grey for none. */
  function communityColor(id) {
    return id >= 0 ? `hsl(${Math.round((id * 137.508) % 360)} 75% 66%)` : 'var(--community-none)';
  }

  /** Fit the map to one community's shown members and say so. */
  function showCommunity(group) {
    const ids = DATA.nodes.filter((node) => node.community === group.id && state.screen.has(node.id));
    if (!ids.length) return announce(`${group.name} has no stars shown. Tick more types under show.`);
    fit(ids.map((node) => node.id));
    announce(`Community ${group.name}: ${group.size} members.`);
  }

  /** SVG for one kind of star centred on (x, y): always round, built from the circles in STAR_PARTS. */
  function starElement(kind, x, y, r) {
    const star = svgEl('g');
    STAR_PARTS[kind].forEach(([part, offset, size]) => {
      star.append(svgEl('circle', { class: `star-${part}`, cx: x + offset * r, cy: y, r: size * r }));
    });
    return star;
  }

  /** A small icon of a node's kind of star, for lists (16×16 SVG). */
  function shapeIcon(type) {
    const svg = svgEl('svg', {
      class: 'shape',
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    const shape = starElement(typeInfo(type).star, 8, 8, 5);
    shape.setAttribute('class', `node node--${type}`);
    svg.append(shape);
    return svg;
  }

  /** Names for files, hubs, and the selected node with its neighbours. */
  function drawLabels() {
    state.drawn.labels = new Map();
    const labels = [];
    const near = nearSelection();
    state.drawn.nodes.forEach((_shape, id) => {
      const node = nodeById.get(id);
      const isHub = (degree.get(id) || 0) >= HUB_LABEL_DEGREE;
      if (!((state.showLabels && (node.type === 'file' || isHub)) || near.has(id))) return;
      const label = svgEl('text', { class: 'label' });
      label.textContent = node.type === 'file' ? fileLabel(node.name) : node.name;
      if (state.screen.has(id)) placeLabel(label, state.screen.get(id)); // new nodes: place() does it
      state.drawn.labels.set(id, label);
      labels.push(label);
    });
    els.labelLayer.replaceChildren(...labels, ...islandLabels());
    placeIslands();
  }

  /** The background stars (the same pattern every time): all around the sky in 3D, scattered flat in 2D. */
  function drawStars() {
    const random = seededRandom(STAR_SEED);
    state.sky = Array.from({ length: STAR_COUNT }, (_, i) => {
      const [x, y, bright] = [random() * 100, random() * 100, random()];
      const dot = svgEl('circle', {
        r: (0.4 + bright * bright * 1.2).toFixed(2),
        opacity: (0.25 + bright * 0.6).toFixed(2),
        class: i % 7 === 0 ? 'star star--warm' : 'star',
      });
      return { dot, x, y, dir: skyDirection(random() * 2 - 1, random() * Math.PI * 2) };
    });
    els.starLayer.replaceChildren(...state.sky.map((star) => star.dot));
  }

  /** A direction from height (-1 to 1) and angle: spreads stars evenly over the whole sky. */
  function skyDirection(height, angle) {
    const ring = Math.sqrt(1 - height * height);
    return [ring * Math.cos(angle), height, ring * Math.sin(angle)];
  }

  /** Put the stars where they are now. 3D: only the sky beyond the galaxy shows, and it turns with it. */
  function placeStars() {
    const { box } = state;
    const reach = Math.hypot(box.width, box.height) * SKY_REACH;
    state.sky.forEach((star, i) => {
      if (state.mode !== '3d') return placeFlatStar(star, i);
      const [x, y, depth] = turned(star.dir);
      star.dot.setAttribute('visibility', depth > 0 ? 'visible' : 'hidden');
      if (depth <= 0) return;
      star.dot.setAttribute('cx', box.width / 2 + x * reach);
      star.dot.setAttribute('cy', box.height / 2 + y * reach);
    });
  }

  /** 2D: the first stars, at fixed spots. */
  function placeFlatStar(star, i) {
    star.dot.setAttribute('visibility', i < FLAT_STAR_COUNT ? 'visible' : 'hidden');
    star.dot.setAttribute('cx', `${star.x.toFixed(2)}%`);
    star.dot.setAttribute('cy', `${star.y.toFixed(2)}%`);
  }

  /** The nebula clouds: real places in the galaxy (one around each island, a few loose), so they turn with it. */
  function drawNebulae() {
    const random = seededRandom(NEBULA_SEED);
    const radius = state.camera.distance / 3;
    const growth = armGrowth();
    const middles = [...HOMES.values()].map(({ disc }) => ({ x: disc.x * growth, y: 0, z: disc.z * growth }));
    const loose = Math.max(NEBULA_MIN_LOOSE, NEBULA_COLORS.length - middles.length);
    for (let i = 0; i < loose; i++) {
      const [x, y, z] = skyDirection(random() * 2 - 1, random() * Math.PI * 2);
      const far = radius * (0.3 + random() * 0.8);
      middles.push({ x: x * far, y: y * far, z: z * far });
    }
    state.drawn.clouds = middles.flatMap((middle, i) =>
      nebulaPuffs(random, NEBULA_COLORS[i % NEBULA_COLORS.length], middle, radius),
    );
    state.drawn.clouds.push(galaxyCore(radius));
    state.drawn.dust = armDust(random, radius, growth);
    els.nebulaLayer.replaceChildren(
      ...state.drawn.clouds.map((puff) => puff.shape),
      ...state.drawn.dust.map((group) => group.path),
    );
  }

  /** How much farther out the islands settled than their homes (their stars push apart), so arms and clouds match. */
  function armGrowth() {
    const ratios = [...HOMES].map(([project, { disc }]) => {
      const points = DATA.nodes
        .filter((node) => projectOf(node) === project && state.positions.has(node.id))
        .map((node) => state.positions.get(node.id));
      if (!points.length) return 1;
      const mean = (axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length;
      return Math.hypot(mean('x'), mean('z')) / Math.hypot(disc.x, disc.z);
    });
    return ratios.length ? ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length : 1;
  }

  /** The bright glow at the very centre. */
  function galaxyCore(radius) {
    const size = (radius * 0.34).toFixed(1);
    const shape = svgEl('ellipse', { class: 'nebula', rx: size, ry: size, fill: 'url(#nebula-core)' });
    return { point: { x: 0, y: 0, z: 0 }, shape };
  }

  /** Tiny stars along the arms: one cool and one warm path, so thousands of dots stay cheap to move. */
  function armDust(random, radius, growth) {
    const first = [...HOMES.values()][0];
    const armRadius = first ? (Math.hypot(first.disc.x, first.disc.z) / first.disc.t) * growth : radius;
    const scatter = () => (random() - 0.5) * armRadius * 0.16;
    const groups = ['dust', 'dust dust--warm'].map((name) => ({
      path: svgEl('path', { class: name }),
      points: [],
    }));
    for (let i = 0; i < DUST_COUNT; i++) {
      const spot = spiralPoint(random() ** 0.7 * 1.1, i % 2, armRadius);
      const point = { x: spot.x + scatter(), y: scatter() * 0.6, z: spot.z + scatter() };
      groups[i % 5 === 0 ? 1 : 0].points.push(point);
    }
    return groups;
  }

  /** Move the dust (3D only: the flat map has no arms). */
  function placeDust() {
    state.drawn.dust.forEach(({ path, points }) => {
      const dots = points.map(project).map((spot) => `M${spot.x.toFixed(1)} ${spot.y.toFixed(1)}h0`);
      path.setAttribute('d', state.mode === '3d' ? dots.join('') : '');
    });
  }

  /** One cloud: soft ellipses bunched around a point, sized in proportion to the galaxy. */
  function nebulaPuffs(random, color, middle, radius) {
    const spread = () => (random() - 0.5) * 0.68 * radius;
    return Array.from({ length: NEBULA_PUFFS }, () => ({
      point: { x: middle.x + spread(), y: middle.y + spread(), z: middle.z + spread() },
      shape: svgEl('ellipse', {
        class: 'nebula',
        rx: (radius * (0.1 + random() * 0.18)).toFixed(1),
        ry: (radius * (0.12 + random() * 0.22)).toFixed(1),
        fill: `url(#nebula-${color})`,
        opacity: (0.15 + random() * 0.25).toFixed(2),
      }),
    }));
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

  /** Combined maps: one title per project (only while labels are on), placed over its island by place(). */
  function islandLabels() {
    state.drawn.islands = new Map();
    if (!state.showLabels) return [];
    HOMES.forEach((_home, project) => {
      const label = svgEl('text', { class: 'label label--project' });
      label.textContent = project;
      state.drawn.islands.set(project, label);
    });
    return [...state.drawn.islands.values()];
  }

  /** Each project title centred just above its island (hidden when none of it is shown). */
  function placeIslands() {
    state.drawn.islands.forEach((label, project) => {
      const points = [...state.screen]
        .filter(([id]) => projectOf(nodeById.get(id)) === project)
        .map(([, p]) => p);
      label.toggleAttribute('hidden', !points.length);
      if (!points.length) return;
      const xs = points.map((point) => point.x);
      label.setAttribute('x', (Math.min(...xs) + Math.max(...xs)) / 2);
      label.setAttribute('y', Math.min(...points.map((point) => point.y)) - 40);
    });
  }

  /** "app.js", or "my_site/app.js" in a combined map (files' names repeat across projects). */
  function fileLabel(path) {
    const parts = path.split('/');
    return DATA.meta.projects ? `${parts[0]}/${parts[parts.length - 1]}` : parts[parts.length - 1];
  }

  /** Where a layout point sits in the spiral: flattened, twisted harder near the middle, and drawn inward. */
  function galaxyPoint({ x, y, z }) {
    const reach = Math.hypot(x, z) / (state.galaxyRadius || 1);
    const angle = Math.atan2(z, x) + SWIRL / (0.35 + reach);
    const pulled = reach ** PULL * state.galaxyRadius;
    return { x: Math.cos(angle) * pulled, y: y * FLATTEN, z: Math.sin(angle) * pulled };
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

  /** Remove the tiny rounding errors that build up over endless spinning, so the galaxy never skews. */
  function straightened(m) {
    const unit = ([x, y, z]) => [x, y, z].map((value) => value / Math.hypot(x, y, z));
    const a = unit(m.slice(0, 3));
    const dot = a[0] * m[3] + a[1] * m[4] + a[2] * m[5];
    const b = unit([m[3] - dot * a[0], m[4] - dot * a[1], m[5] - dot * a[2]]);
    return [...a, ...b, a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  /** [x, y, depth] of a vector after the camera's turn. */
  function turned([x, y, z]) {
    const r = state.camera.rotation;
    return [r[0] * x + r[1] * y + r[2] * z, r[3] * x + r[4] * y + r[5] * z, r[6] * x + r[7] * y + r[8] * z];
  }

  /** Where a layout point is drawn: as is in 2D; in 3D turned by the camera, then in perspective. */
  function project(point) {
    if (state.mode !== '3d') return { x: point.x, y: point.y, s: 1, depth: 0 };
    const { pivot } = state;
    const spot = galaxyPoint(point);
    const [x, y, depth] = turned([spot.x - pivot.x, spot.y - pivot.y, spot.z - pivot.z]); // bigger depth = farther
    const { distance } = state.camera;
    const s = distance / Math.max(distance * 0.2, distance + depth);
    return { x: x * s, y: y * s, s, depth };
  }

  /** How far the 3D camera sits: about three times the map's radius, for a gentle perspective. */
  function cameraDistance(nodes) {
    const radius = nodes.reduce((most, node) => {
      const { x, y, z } = state.positions.get(node.id);
      return Math.max(most, Math.sqrt(x * x + y * y + z * z));
    }, 0);
    return Math.max(600, radius * 3);
  }

  /** Move every shape, line and label to where it's drawn now (and, in 3D, far ones behind near ones). */
  function place() {
    state.screen = new Map();
    state.drawn.nodes.forEach((shape, id) => {
      const point = project(state.positions.get(id));
      state.screen.set(id, point);
      shape.setAttribute('transform', `translate(${point.x} ${point.y}) scale(${point.s})`);
    });
    state.drawn.edges.forEach(({ edge, line }) => {
      const a = state.screen.get(edge.source);
      const b = state.screen.get(edge.target);
      Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }).forEach(([key, value]) =>
        line.setAttribute(key, value),
      );
    });
    state.drawn.labels.forEach((label, id) => placeLabel(label, state.screen.get(id)));
    placeIslands();
    placeClouds();
    placeDust();
    placeStars();
    if (state.mode === '3d' && !isSpinning()) sortByDepth();
  }

  /** Whether the galaxy is turning right now: the stars are re-layered once it stops, to keep spinning smooth. */
  function isSpinning() {
    return Boolean(state.idle.active || state.glide || (state.drag && state.drag.moved));
  }

  /** Move each puff of cloud to where it's drawn now (nearer ones look bigger, like the stars). */
  function placeClouds() {
    state.drawn.clouds.forEach(({ shape, point }) => {
      const spot = project(point);
      shape.setAttribute('transform', `translate(${spot.x} ${spot.y}) scale(${spot.s})`);
    });
  }

  /** A label just right of its shape. */
  function placeLabel(label, point) {
    label.setAttribute('x', point.x + 12 * point.s);
    label.setAttribute('y', point.y + 4);
  }

  /** 3D: draw far shapes first, so near ones cover them. */
  function sortByDepth() {
    const byDepth = [...state.drawn.nodes].sort(
      ([a], [b]) => state.screen.get(b).depth - state.screen.get(a).depth,
    );
    els.nodeLayer.append(...byDepth.map(([, shape]) => shape));
  }

  /** Re-place on the next frame (turning fires many pointer events per frame). */
  function placeSoon() {
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      place();
    });
  }

  /* ==========================================================================
     07  ZOOM, PAN & 3D — buttons, wheel/trackpad, drag, and arrow keys (a
     non-drag alternative, WCAG 2.5.7). In 3D, dragging turns the map.
     ========================================================================== */
  /** Switch between the flat map and the 3D one (a fresh layout, then fit it). */
  function toggleDepth() {
    state.mode = state.mode === '3d' ? '2d' : '3d';
    const is3d = state.mode === '3d';
    showMode();
    state.switched = HOMES.size > 0; // combined maps: islands move between the ring and the sphere
    redraw();
    state.switched = false;
    fit();
    announce(is3d ? '3D view. Drag or use the arrow keys to turn the map.' : '2D view.');
  }

  /** The 3D button's state and the hint under the map, for the current mode. */
  function showMode() {
    els.depthBtn.setAttribute('aria-pressed', String(state.mode === '3d'));
    els.mapHint.textContent = HINTS[state.mode];
  }

  /** 3D: spin the galaxy a little more around the screen's own axes, so it always follows the pointer
      and has no end stop in any direction. */
  function turnBy(yaw, tilt) {
    state.camera.rotation = straightened(multiply(turnMatrix(yaw, tilt), state.camera.rotation));
    pauseDrift();
    placeSoon();
  }

  /** 3D: move what's in the middle of the screen, so turning always stays centred on it. */
  function panBy(dx, dy) {
    const r = state.camera.rotation;
    const { k } = state.view;
    state.pivot = {
      x: state.pivot.x - (r[0] * dx + r[3] * dy) / k,
      y: state.pivot.y - (r[1] * dx + r[4] * dy) / k,
      z: state.pivot.z - (r[2] * dx + r[5] * dy) / k,
    };
    pauseDrift();
    placeSoon();
  }

  /** Someone is moving the galaxy: hold the slow turn for a moment. */
  function pauseDrift() {
    state.idle.pausedUntil = performance.now() + IDLE_RESUME_MS;
  }

  /** Whether the galaxy may turn by itself now (not while it's held, or a star is being read). */
  function canDrift(time) {
    const held = state.drag || state.glide || state.selected;
    return state.mode === '3d' && !held && !LESS_MOTION.matches && time >= state.idle.pausedUntil;
  }

  /** One step of the slow turn, around the galaxy's own axis (stops by itself in a hidden tab). */
  function stepDrift(time) {
    requestAnimationFrame(stepDrift);
    const { idle } = state;
    const elapsed = time - idle.last;
    if (elapsed < IDLE_FRAME_MS) return;
    idle.last = time;
    if (!canDrift(time)) return;
    const angle = (Math.min(elapsed, 200) / 1000) * IDLE_SPEED;
    state.camera.rotation = straightened(multiply(state.camera.rotation, turnMatrix(angle, 0)));
    idle.active = true;
    place();
    idle.active = false;
    if (time - idle.sorted > IDLE_SORT_MS) {
      idle.sorted = time;
      sortByDepth();
    }
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
    const wasGliding = Boolean(state.glide);
    if (wasGliding) cancelAnimationFrame(state.glide.frame);
    state.glide = null;
    if (wasGliding && state.mode === '3d') sortByDepth();
  }

  /** Remember the map's size. */
  function measureMap() {
    const { width, height } = els.graph.getBoundingClientRect();
    state.box = { width, height };
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
      applyView();
      placeSoon();
    }).observe(els.graph);
  }

  /** Apply state.view to the SVG. */
  function applyView() {
    const { x, y, k } = state.view;
    els.viewport.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
    els.graph.style.setProperty('--zoom', String(k)); // keeps label text readable (style.css .label)
    els.glowBlur.setAttribute('stdDeviation', String(GLOW_PX / k)); // the same glow on screen at any zoom
  }

  /** Zoom by `factor` around a point given in screen pixels (default: the centre). */
  function zoomBy(factor, px, py) {
    const box = els.graph.getBoundingClientRect();
    const cx = px === undefined ? box.width / 2 : px;
    const cy = py === undefined ? box.height / 2 : py;
    const k = Math.max(MIN_ZOOM, Math.min(6, state.view.k * factor));
    const ratio = k / state.view.k;
    if (state.mode === '3d') {
      state.view = { ...state.view, k };
      applyView();
      return panBy((cx - box.width / 2) * (1 - ratio), (cy - box.height / 2) * (1 - ratio));
    }
    state.view = { x: cx - (cx - state.view.x) * ratio, y: cy - (cy - state.view.y) * ratio, k };
    applyView();
  }

  /** Fit all visible nodes (or one node's neighbourhood) into the map area. */
  function fit(ids = [...state.drawn.nodes.keys()]) {
    if (!ids.length) return;
    if (state.mode === '3d') pivotOn(ids);
    const points = ids.map((id) => state.screen.get(id)).filter(Boolean);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const box = els.graph.getBoundingClientRect();
    // 3D keeps the pivot in the exact middle, so the map is measured outward from it
    const span = (values) =>
      (state.mode === '3d'
        ? 2 * Math.max(...values.map(Math.abs))
        : Math.max(...values) - Math.min(...values)) || 1;
    const room = (size) => Math.max(40, size - FIT_MARGIN * 2); // the margin is in screen pixels: titles fit
    const k = Math.max(
      MIN_ZOOM,
      Math.min(2.5, Math.min(room(box.width) / span(xs), room(box.height) / span(ys))),
    );
    const middle = (values) => (state.mode === '3d' ? 0 : (Math.max(...values) + Math.min(...values)) / 2);
    state.view = { x: box.width / 2 - middle(xs) * k, y: box.height / 2 - middle(ys) * k, k };
    applyView();
  }

  /** 3D: turn around the middle of these nodes from now on. */
  function pivotOn(ids) {
    if (ids.length === state.drawn.nodes.size && !state.hiddenProjects.size) {
      state.pivot = { x: 0, y: 0, z: 0 }; // the whole galaxy turns around its core
      place();
      return;
    }
    const points = ids
      .map((id) => state.positions.get(id))
      .filter(Boolean)
      .map(galaxyPoint);
    const middle = (axis) => {
      const values = points.map((point) => point[axis]);
      return (Math.min(...values) + Math.max(...values)) / 2;
    };
    state.pivot = { x: middle('x'), y: middle('y'), z: middle('z') };
    place();
  }

  /** Pointer down on the map: start a possible drag, remembering the shape under the pointer. */
  function startDrag(event) {
    stopGlide();
    // Remember the shape now: pointer capture makes later events target the <svg> itself.
    const shape = event.target.closest('.node');
    const id = shape ? shape.dataset.id : null;
    state.drag = {
      x: event.clientX,
      y: event.clientY,
      view: { ...state.view },
      lastX: event.clientX,
      lastY: event.clientY,
      spin: null, // the latest bit of turning, to coast on after letting go
      moved: false,
      id,
    };
    els.graph.setPointerCapture(event.pointerId);
  }

  /** Pointer move: pan once it has moved a few pixels (smaller wobbles still count as a click). */
  function moveDrag(event) {
    const drag = state.drag;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const [stepX, stepY] = [event.clientX - drag.lastX, event.clientY - drag.lastY];
    Object.assign(drag, { lastX: event.clientX, lastY: event.clientY });
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    els.graph.classList.add('is-panning');
    if (state.mode === '3d') return moveDrag3d(drag, event, stepX, stepY);
    state.view = { ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy };
    applyView();
  }

  /** 3D drag: turn the galaxy, or with Shift pan it. */
  function moveDrag3d(drag, event, stepX, stepY) {
    if (event.shiftKey) return panBy(stepX, stepY);
    drag.spin = { yaw: stepX * TURN_SPEED, tilt: -stepY * TURN_SPEED, at: event.timeStamp };
    turnBy(drag.spin.yaw, drag.spin.tilt);
  }

  /** Pointer up (or cancelled): a click without movement selects the shape, or clears on the background;
      a spin that was still moving keeps coasting. */
  function endDrag(event) {
    const drag = state.drag;
    if (drag && !drag.moved && event.type === 'pointerup') select(drag.id);
    if (drag && drag.spin && event.timeStamp - drag.spin.at < GLIDE_RECENT_MS) startGlide(drag.spin);
    state.drag = null;
    if (drag && drag.moved && !state.glide && state.mode === '3d') sortByDepth();
    els.graph.classList.remove('is-panning');
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
    if (pan && state.mode === '3d' && !event.shiftKey) {
      turnBy(pan[0] * TURN_STEP, -pan[1] * TURN_STEP);
    } else if (pan && state.mode === '3d') {
      panBy(pan[0] * PAN_STEP, pan[1] * PAN_STEP);
    } else if (pan) {
      const { x, y, k } = state.view;
      state.view = { x: x + pan[0] * PAN_STEP, y: y + pan[1] * PAN_STEP, k };
      applyView();
    } else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
    else if (event.key === '-') zoomBy(1 / ZOOM_STEP);
    else if (event.key === '0') fit();
    else return;
    event.preventDefault();
  }

  /* ==========================================================================
     08  SELECTION & HIGHLIGHTING
     ========================================================================== */
  /** The selected node plus everything directly linked to it (by links that are shown). */
  function nearSelection() {
    const near = new Set();
    if (!state.selected) return near;
    near.add(state.selected);
    (edgesOut.get(state.selected) || []).filter(edgeShown).forEach((edge) => near.add(edge.target));
    (edgesIn.get(state.selected) || []).filter(edgeShown).forEach((edge) => near.add(edge.source));
    return near;
  }

  /** Select a node (or null to clear): highlight it, show its details, announce it. */
  function select(id) {
    if (id && !nodeShown(nodeById.get(id))) {
      state.shownTypes.add(nodeById.get(id).type); // make sure it's on the map
      state.hiddenProjects.delete(projectOf(nodeById.get(id)));
      syncFilterBoxes();
      state.selected = id;
      redraw();
    }
    state.selected = id && nodeById.has(id) ? id : null;
    drawLabels();
    highlight();
    renderDetails();
    if (state.selected) {
      const node = nodeById.get(state.selected);
      announce(`Selected ${node.name}, ${node.type}`);
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

  /** Fade everything except the selection and its neighbours. */
  function highlight() {
    const near = nearSelection();
    els.graph.classList.toggle('has-focus', Boolean(state.selected));
    state.drawn.nodes.forEach((shape, id) => {
      shape.classList.toggle('is-near', near.has(id));
      shape.classList.toggle('is-selected', id === state.selected);
    });
    state.drawn.edges.forEach(({ edge, line }) => {
      line.classList.toggle('is-near', edge.source === state.selected || edge.target === state.selected);
    });
    state.drawn.labels.forEach((label, id) => label.classList.toggle('is-near', near.has(id)));
  }

  /** Select from a list (search, details, health) and bring the node into view. */
  function goTo(id) {
    select(id);
    if (state.mode === '3d' && state.positions.has(id)) {
      state.pivot = galaxyPoint(state.positions.get(id)); // turning now centres on this node
      place();
    }
    const point = state.screen.get(id);
    if (!point) return;
    const box = els.graph.getBoundingClientRect();
    const k = state.view.k;
    state.view = { x: box.width / 2 - point.x * k, y: box.height / 2 - point.y * k, k };
    applyView();
    if (!window.matchMedia('(width >= 1000px)').matches) els.graph.scrollIntoView({ block: 'nearest' });
  }

  /* ==========================================================================
     09  DETAILS PANEL
     ========================================================================== */
  /** The selected node's details, or the project overview. */
  function renderDetails() {
    if (!state.selected) {
      els.detailsTitle.textContent = 'overview';
      els.detailsBody.replaceChildren(...overviewContent());
      return;
    }
    const node = nodeById.get(state.selected);
    els.detailsTitle.textContent = 'selected';
    const outgoing = (edgesOut.get(node.id) || []).filter(edgeShown);
    const incoming = (edgesIn.get(node.id) || []).filter(edgeShown);
    els.detailsBody.replaceChildren(
      selectedHeader(node),
      linkGroup(`used by (${incoming.length})`, incoming, 'in'),
      linkGroup(`uses (${outgoing.length})`, outgoing, 'out'),
    );
  }

  /** Whether an edge passes the "inferred links" filter. */
  function edgeShown(edge) {
    return state.showInferred || edge.certainty !== 'inferred';
  }

  /** Name, type, location and any health badge. */
  function selectedHeader(node) {
    const header = el('div');
    const name = el('p', 'selected-name');
    name.append(shapeIcon(node.type), document.createTextNode(node.name));
    const lang = node.lang ? ` · ${node.lang}` : '';
    header.append(name, el('p', 'selected-meta', `${node.type} · ${where(node)}${lang}`));
    const group = COMMUNITIES.find((entry) => entry.id === node.community);
    if (group) header.append(communityButton(group, 'community: '));
    if (healthOf.has(node.id)) header.append(el('span', 'badge', `possible issue: ${healthOf.get(node.id)}`));
    return header;
  }

  /** A titled list of links; each row selects the node at the other end. */
  function linkGroup(title, edges, direction) {
    const group = el('section', 'link-group');
    group.append(el('h3', '', title));
    const sorted = [...edges].sort((a, b) => a.kind.localeCompare(b.kind));
    const list = el('ul', 'results');
    sorted.slice(0, MAX_LIST).forEach((edge) => {
      const otherId = direction === 'out' ? edge.target : edge.source;
      list.append(nodeRow(otherId, LINK_WORDS[direction][edge.kind] || edge.kind, edge));
    });
    if (!edges.length) group.append(el('p', 'empty-note', 'nothing'));
    else group.append(list);
    if (edges.length > MAX_LIST) {
      group.append(el('p', 'empty-note', `…and ${edges.length - MAX_LIST} more`));
    }
    return group;
  }

  /** A clickable row for one node (optionally with the link kind and "inferred"). */
  function nodeRow(id, kindText, edge) {
    const node = nodeById.get(id);
    const item = el('li');
    const button = el('button', 'node-link');
    button.type = 'button';
    if (kindText) button.append(el('span', 'link-kind', kindText));
    button.append(shapeIcon(node.type), el('span', 'node-name', node.name));
    if (edge && edge.certainty === 'inferred') button.append(el('span', 'inferred-tag', 'inferred'));
    button.append(el('span', 'node-where', shortWhere(node)));
    button.addEventListener('click', () => {
      goTo(id);
      // Rows in the details panel are rebuilt by goTo: keep keyboard focus nearby, not lost to <body>.
      if (!button.isConnected) els.details.focus({ preventScroll: true });
    });
    item.append(button);
    return item;
  }

  /* ==========================================================================
     10  OVERVIEW & HEALTH
     ========================================================================== */
  /** Counts, the biggest hubs, and a hint — shown when nothing is selected. */
  function overviewContent() {
    if (!DATA.nodes.length) {
      return [el('p', 'empty-note', 'No graph data. Open the graph.html made by atlas.py build.')];
    }
    const stats = el('dl', 'overview-stats');
    TYPES.forEach(({ type, label }) => {
      const count = DATA.nodes.filter((node) => node.type === type).length;
      if (!count) return;
      const box = el('div');
      box.append(el('dt', '', label), el('dd', '', String(count)));
      stats.append(box);
    });
    const hubs = DATA.nodes
      .filter((node) => node.type === 'function' || node.type === 'class')
      .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))
      .slice(0, 8);
    const hubList = el('ul', 'results');
    hubs.forEach((node) => hubList.append(nodeRow(node.id, `${degree.get(node.id) || 0} links`)));
    const hubGroup = el('section', 'link-group');
    hubGroup.append(el('h3', '', 'hubs: most connected'), hubList);
    const hint = el('p', 'empty-note', 'Click a star, or search, to see what uses it and what it uses.');
    return [stats, hubGroup, ...communityGroup(), hint];
  }

  /** The biggest communities, each a button that fits the map to it (none: nothing to show). */
  function communityGroup() {
    if (!COMMUNITIES.length) return [];
    const list = el('ul', 'results');
    COMMUNITIES.slice(0, 8).forEach((group) => {
      const item = el('li');
      item.append(communityButton(group, ''));
      list.append(item);
    });
    const section = el('section', 'link-group');
    section.append(el('h3', '', `communities (${COMMUNITIES.length})`), list);
    return [section];
  }

  /** A button for a community: its colour, name and size; it fits the map to the community. */
  function communityButton(group, prefix) {
    const button = el('button', 'node-link community-link');
    button.type = 'button';
    button.title = `${group.name} (${group.size} members)`; // the full name, when the list cuts it short
    const swatch = el('span', 'swatch');
    swatch.style.setProperty('--community', communityColor(group.id));
    button.append(
      swatch,
      el('span', 'node-name', `${prefix}${group.name}`),
      el('span', 'node-where', `${group.size}`),
    );
    button.addEventListener('click', () => showCommunity(group));
    return button;
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
     12  FILTER CHECKBOXES
     ========================================================================== */
  /** One checkbox per node type (with its shape and count). */
  function buildFilters() {
    els.typeFilters.replaceChildren(
      ...TYPES.map(({ type, label }) => {
        const count = DATA.nodes.filter((node) => node.type === type).length;
        const row = el('label', 'check');
        const box = el('input', 'check-input');
        box.type = 'checkbox';
        box.value = type;
        box.checked = count > 0 && state.shownTypes.has(type);
        box.disabled = count === 0;
        row.append(box, shapeIcon(type), el('span', '', label), el('span', 'check-count', String(count)));
        return row;
      }),
    );
  }

  /** Tick boxes to match state (after select() turns a type on). */
  function syncFilterBoxes() {
    els.typeFilters.querySelectorAll('input').forEach((box) => {
      box.checked = state.shownTypes.has(box.value);
    });
    syncIslands();
  }

  /** A type box changed: show/hide that type and redraw. */
  function handleFilterChange(event) {
    const box = event.target;
    if (box.checked) state.shownTypes.add(box.value);
    else state.shownTypes.delete(box.value);
    redraw();
    fit();
    renderDetails();
  }

  /** Combined maps: one row per project in the Islands panel. */
  function buildIslands() {
    const projects = [...HOMES.keys()];
    els.islandPanel.hidden = !projects.length;
    els.islandList.replaceChildren(...projects.map(islandRow));
    syncIslands();
  }

  /** One island: a box to show or hide it, its name (flies there), and how many files it has. */
  function islandRow(project) {
    const files = DATA.nodes.filter((node) => node.type === 'file' && projectOf(node) === project).length;
    const row = el('div', 'check island-row');
    const hit = el('label', 'island-box'); // a bigger area to tap than the box itself
    const box = el('input', 'check-input');
    box.type = 'checkbox';
    box.value = project;
    hit.append(box);
    box.setAttribute('aria-label', `Show ${project}`);
    const name = el('button', 'island-name', project);
    name.type = 'button';
    name.title = `Fly to ${project}`;
    name.dataset.project = project;
    row.append(hit, name, el('span', 'check-count', `${files} ${files === 1 ? 'file' : 'files'}`));
    return row;
  }

  /** Make the boxes, the "8 of 8" count and the show/hide-all button match state. */
  function syncIslands() {
    const total = HOMES.size;
    els.islandList.querySelectorAll('input').forEach((box) => {
      box.checked = !state.hiddenProjects.has(box.value);
    });
    els.islandCount.textContent = `${total - state.hiddenProjects.size} of ${total}`;
    els.islandToggle.textContent = state.hiddenProjects.size ? 'show all' : 'hide all';
  }

  /** The islands changed: redraw, fit, and update the panel. */
  function refreshIslands() {
    syncIslands();
    redraw();
    fit();
    renderDetails();
    announce(`${els.islandCount.textContent} islands shown.`);
  }

  /** An island's box changed. */
  function handleIslandChange(event) {
    const { value, checked } = event.target;
    if (checked) state.hiddenProjects.delete(value);
    else state.hiddenProjects.add(value);
    refreshIslands();
  }

  /** Show every island, or hide them all if none is hidden. */
  function toggleAllIslands() {
    state.hiddenProjects = new Set(state.hiddenProjects.size ? [] : HOMES.keys());
    refreshIslands();
  }

  /** Fit the map to one island (showing it first if it's hidden). */
  function flyToIsland(project) {
    if (state.hiddenProjects.delete(project)) refreshIslands();
    const ids = [...state.drawn.nodes.keys()].filter((id) => projectOf(nodeById.get(id)) === project);
    if (!ids.length) return announce(`${project} has nothing shown. Tick more types under show.`);
    fit(ids);
    announce(`Showing ${project}.`);
  }

  /** A click in the islands list: only the names do anything (the boxes use "change"). */
  function handleIslandClick(event) {
    const name = event.target.closest('[data-project]');
    if (name) flyToIsland(name.dataset.project);
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
      els.searchInput.focus();
    } else if (event.key === '?') {
      event.preventDefault();
      els.helpDialog.showModal();
    } else if (event.key === 'Escape' && state.selected) {
      select(null);
    }
  }

  /* ==========================================================================
     15  INIT
     ========================================================================== */
  /** The map: drag, wheel, keys, and the zoom / fit / 3D buttons. */
  function bindMap() {
    els.graph.addEventListener('pointerdown', startDrag);
    els.graph.addEventListener('pointermove', moveDrag);
    els.graph.addEventListener('pointerup', endDrag);
    els.graph.addEventListener('pointercancel', endDrag);
    els.graph.addEventListener('wheel', handleWheel, { passive: false });
    els.graph.addEventListener('keydown', handleMapKeys);
    els.zoomInBtn.addEventListener('click', () => zoomBy(ZOOM_STEP));
    els.zoomOutBtn.addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
    els.fitBtn.addEventListener('click', () => fit());
    els.depthBtn.addEventListener('click', toggleDepth);
  }

  /** The "show" panel: node types, inferred links, labels and community colours. */
  function bindFilters() {
    els.typeFilters.addEventListener('change', handleFilterChange);
    els.islandList.addEventListener('change', handleIslandChange);
    els.islandList.addEventListener('click', handleIslandClick);
    els.islandToggle.addEventListener('click', toggleAllIslands);
    els.inferredToggle.addEventListener('change', () => {
      state.showInferred = els.inferredToggle.checked;
      redraw();
      renderDetails();
    });
    els.communityToggle.addEventListener('change', () => {
      state.byCommunity = els.communityToggle.checked;
      els.graph.classList.toggle('by-community', state.byCommunity);
    });
    els.labelsToggle.addEventListener('change', () => {
      state.showLabels = els.labelsToggle.checked;
      drawLabels();
      highlight();
    });
  }

  /** Wire every control. */
  function bindEvents() {
    bindMap();
    els.searchInput.addEventListener('input', handleSearch);
    els.searchInput.addEventListener('keydown', handleSearchKeys);
    bindFilters();
    els.helpBtn.addEventListener('click', () => els.helpDialog.showModal());
    els.helpDialog.addEventListener('click', (event) => {
      if (event.target === els.helpDialog || event.target.closest('[data-close]')) els.helpDialog.close();
    });
    els.themeBtn.addEventListener('click', cycleTheme);
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => applyTheme(state.theme));
    document.addEventListener('keydown', handleShortcuts);
  }

  /** Start: theme, project name, filters, layout, overview, health. */
  function init() {
    applyTheme(readTheme());
    const project = (DATA.meta && DATA.meta.project) || 'project';
    els.projectName.textContent = project;
    document.title = `${project} — Atlas code map`;
    buildFilters();
    buildIslands();
    bindEvents();
    drawStars();
    showMode();
    followMapSize();
    redraw();
    drawNebulae(); // sized to the galaxy, so after the first layout
    fit();
    renderDetails();
    renderHealth();
    openLinkedStar();
    requestAnimationFrame(stepDrift);
  }

  init();
})();
