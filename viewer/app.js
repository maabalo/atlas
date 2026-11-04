/* ==========================================================================
   Atlas — app.js (viewer)
   --------------------------------------------------------------------------
   Reads the graph from <script id="graphData"> (inlined by atlas.py build),
   lays it out with a small force simulation (no libraries), draws it as SVG,
   and lets you search, filter, zoom, pan and inspect it.

   TABLE OF CONTENTS
     01  Settings
     02  Data & indexes
     03  DOM references & small helpers
     04  State & filters
     05  Layout (force simulation)
     06  Drawing the map
     07  Zoom & pan
     08  Selection & highlighting
     09  Details panel
     10  Overview & health
     11  Search
     12  Filter checkboxes
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
  /** Node types: label, map shape, and whether they're shown at first (ids/classes can be busy). */
  const TYPES = [
    { type: 'file', label: 'files', shape: 'square', on: true },
    { type: 'function', label: 'functions', shape: 'circle', on: true },
    { type: 'class', label: 'classes', shape: 'diamond', on: true },
    { type: 'html-id', label: 'html ids', shape: 'triangle', on: false },
    { type: 'css-class', label: 'css classes', shape: 'ring', on: false },
  ];
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
  const HUB_LABEL_DEGREE = 6; // functions with this many links always show their name
  const MAX_LIST = 150; // longest list drawn in the details panel
  const ZOOM_STEP = 1.25;
  const PAN_STEP = 60;
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
    inferredToggle: byId('inferredToggle'),
    healthList: byId('healthList'),
    graph: byId('graph'),
    viewport: byId('viewport'),
    edgeLayer: byId('edgeLayer'),
    nodeLayer: byId('nodeLayer'),
    labelLayer: byId('labelLayer'),
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
    showInferred: true,
    positions: new Map(), // node id → {x, y}, kept between layouts so the map stays stable
    view: { x: 0, y: 0, k: 1 },
    selected: null,
    drag: null, // the pointer gesture in progress (section 07)
    drawn: { nodes: new Map(), edges: [], labels: new Map() },
  };

  /** Nodes whose type is switched on. */
  function visibleNodes() {
    return DATA.nodes.filter((node) => state.shownTypes.has(node.type));
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
    const index = new Map(nodes.map((node, i) => [node.id, i]));
    const links = edges.map((edge) => [index.get(edge.source), index.get(edge.target), linkLength(edge)]);
    const ticks = Math.max(60, Math.min(300, Math.round(4e7 / (nodes.length * nodes.length + 1))));
    for (let tick = 0; tick < ticks; tick++) {
      const alpha = 1 - tick / ticks;
      applyRepulsion(sim, alpha);
      applySprings(sim, links, alpha);
      integrate(sim, alpha);
    }
    nodes.forEach((node, i) => state.positions.set(node.id, { x: sim.x[i], y: sim.y[i] }));
  }

  /** Typed arrays for x/y/velocity; new nodes start near their file (deterministically). */
  function startPositions(nodes) {
    const n = nodes.length;
    const sim = {
      n,
      x: new Float64Array(n),
      y: new Float64Array(n),
      vx: new Float64Array(n),
      vy: new Float64Array(n),
    };
    nodes.forEach((node, i) => {
      const known = state.positions.get(node.id) || state.positions.get(`file:${node.file}`);
      const angle = hash(node.id) * Math.PI * 2;
      const spread = known ? 40 : 300;
      sim.x[i] = (known ? known.x : 0) + Math.cos(angle) * spread * (0.3 + hash(node.id + 'r'));
      sim.y[i] = (known ? known.y : 0) + Math.sin(angle) * spread * (0.3 + hash(node.id + 'r'));
    });
    return sim;
  }

  /** A stable pseudo-random number in [0, 1) from a string (same map every time). */
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return ((h >>> 0) % 10000) / 10000;
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
        const d2 = Math.max(dx * dx + dy * dy, 25);
        const force = (REPULSION * alpha) / d2;
        sim.vx[i] -= dx * force * 0.05;
        sim.vy[i] -= dy * force * 0.05;
        sim.vx[j] += dx * force * 0.05;
        sim.vy[j] += dy * force * 0.05;
      }
    }
  }

  /** Each link pulls its two ends toward its resting length. */
  function applySprings(sim, links, alpha) {
    links.forEach(([a, b, length]) => {
      const dx = sim.x[b] - sim.x[a];
      const dy = sim.y[b] - sim.y[a];
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const pull = ((distance - length) / distance) * SPRING * alpha;
      sim.vx[a] += dx * pull;
      sim.vy[a] += dy * pull;
      sim.vx[b] -= dx * pull;
      sim.vy[b] -= dy * pull;
    });
  }

  /** Gravity toward the centre, friction, then move. */
  function integrate(sim, alpha) {
    for (let i = 0; i < sim.n; i++) {
      sim.vx[i] = (sim.vx[i] - sim.x[i] * GRAVITY * alpha) * 0.6;
      sim.vy[i] = (sim.vy[i] - sim.y[i] * GRAVITY * alpha) * 0.6;
      sim.x[i] += sim.vx[i];
      sim.y[i] += sim.vy[i];
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
    drawEdges(edges);
    drawNodes(nodes);
    drawLabels();
    if (state.selected && !shown.has(state.selected)) state.selected = null;
    highlight();
  }

  /** One <line> per visible edge. */
  function drawEdges(edges) {
    state.drawn.edges = edges.map((edge) => {
      const a = state.positions.get(edge.source);
      const b = state.positions.get(edge.target);
      const extra = edge.certainty === 'inferred' ? ' edge--inferred' : '';
      const className = `edge edge--${edge.kind}${extra}`;
      const line = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: className });
      return { edge, line };
    });
    els.edgeLayer.replaceChildren(...state.drawn.edges.map((item) => item.line));
  }

  /** One shape per visible node; its size grows with its number of links. */
  function drawNodes(nodes) {
    state.drawn.nodes = new Map();
    const shapes = nodes.map((node) => {
      const { x, y } = state.positions.get(node.id);
      const radius = node.type === 'file' ? 9 : 4 + Math.min(10, Math.sqrt(degree.get(node.id) || 0) * 1.6);
      const shape = shapeElement(typeInfo(node.type).shape, x, y, radius);
      shape.setAttribute('class', `node node--${node.type}`);
      shape.dataset.id = node.id;
      state.drawn.nodes.set(node.id, shape);
      return shape;
    });
    els.nodeLayer.replaceChildren(...shapes);
  }

  /** SVG for a shape centred on (x, y): square, circle, diamond, triangle or ring. */
  function shapeElement(shape, x, y, r) {
    if (shape === 'square') return svgEl('rect', { x: x - r, y: y - r, width: r * 2, height: r * 2, rx: 2 });
    if (shape === 'diamond') {
      return svgEl('path', { d: `M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z` });
    }
    if (shape === 'triangle') {
      return svgEl('path', { d: `M${x} ${y - r}L${x + r} ${y + r * 0.8}L${x - r} ${y + r * 0.8}Z` });
    }
    return svgEl('circle', { cx: x, cy: y, r: shape === 'ring' ? r * 0.85 : r });
  }

  /** A small icon of a node's shape, for lists (16×16 SVG). */
  function shapeIcon(type) {
    const svg = svgEl('svg', {
      class: 'shape',
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    const shape = shapeElement(typeInfo(type).shape, 8, 8, 6);
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
      if (!(node.type === 'file' || isHub || near.has(id))) return;
      const { x, y } = state.positions.get(id);
      const label = svgEl('text', { x: x + 12, y: y + 4, class: 'label' });
      label.textContent = node.type === 'file' ? node.name.split('/').pop() : node.name;
      state.drawn.labels.set(id, label);
      labels.push(label);
    });
    els.labelLayer.replaceChildren(...labels);
  }

  /* ==========================================================================
     07  ZOOM & PAN — buttons, wheel/trackpad, drag, and arrow keys (a
     non-drag alternative, WCAG 2.5.7)
     ========================================================================== */
  /** Apply state.view to the SVG. */
  function applyView() {
    const { x, y, k } = state.view;
    els.viewport.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
    els.graph.style.setProperty('--zoom', String(k)); // keeps label text readable (style.css .label)
  }

  /** Zoom by `factor` around a point given in screen pixels (default: the centre). */
  function zoomBy(factor, px, py) {
    const box = els.graph.getBoundingClientRect();
    const cx = px === undefined ? box.width / 2 : px;
    const cy = py === undefined ? box.height / 2 : py;
    const k = Math.max(0.1, Math.min(6, state.view.k * factor));
    const ratio = k / state.view.k;
    state.view = { x: cx - (cx - state.view.x) * ratio, y: cy - (cy - state.view.y) * ratio, k };
    applyView();
  }

  /** Fit all visible nodes (or one node's neighbourhood) into the map area. */
  function fit(ids = [...state.drawn.nodes.keys()]) {
    if (!ids.length) return;
    const points = ids.map((id) => state.positions.get(id)).filter(Boolean);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const box = els.graph.getBoundingClientRect();
    const width = Math.max(...xs) - Math.min(...xs) + 120;
    const height = Math.max(...ys) - Math.min(...ys) + 120;
    const k = Math.max(0.1, Math.min(2.5, Math.min(box.width / width, box.height / height)));
    const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
    const midY = (Math.max(...ys) + Math.min(...ys)) / 2;
    state.view = { x: box.width / 2 - midX * k, y: box.height / 2 - midY * k, k };
    applyView();
  }

  /** Pointer down on the map: start a possible drag, remembering the shape under the pointer. */
  function startDrag(event) {
    // Remember the shape now: pointer capture makes later events target the <svg> itself.
    const shape = event.target.closest('.node');
    const id = shape ? shape.dataset.id : null;
    state.drag = { x: event.clientX, y: event.clientY, view: { ...state.view }, moved: false, id };
    els.graph.setPointerCapture(event.pointerId);
  }

  /** Pointer move: pan once it has moved a few pixels (smaller wobbles still count as a click). */
  function moveDrag(event) {
    const drag = state.drag;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    els.graph.classList.add('is-panning');
    state.view = { ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy };
    applyView();
  }

  /** Pointer up (or cancelled): a click without movement selects the shape, or clears on the background. */
  function endDrag(event) {
    if (state.drag && !state.drag.moved && event.type === 'pointerup') select(state.drag.id);
    state.drag = null;
    els.graph.classList.remove('is-panning');
  }

  /** Wheel / trackpad zooms around the pointer. */
  function handleWheel(event) {
    event.preventDefault();
    const box = els.graph.getBoundingClientRect();
    zoomBy(Math.exp(-event.deltaY * 0.0015), event.clientX - box.left, event.clientY - box.top);
  }

  /** Arrow keys pan, + / - zoom, 0 fits (when the map has focus). ⌘/Ctrl combos stay the browser's. */
  function handleMapKeys(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const pan = PAN_KEYS[event.key];
    if (pan) {
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
    if (id && !state.shownTypes.has(nodeById.get(id).type)) {
      state.shownTypes.add(nodeById.get(id).type); // make sure it's on the map
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
    const point = state.positions.get(id);
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
    button.append(el('span', 'node-where', node.line ? `${node.file.split('/').pop()}:${node.line}` : ''));
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
    const hint = el('p', 'empty-note', 'Click a shape, or search, to see what uses it and what it uses.');
    return [stats, hubGroup, hint];
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
  /** Wire every control. */
  function bindEvents() {
    els.graph.addEventListener('pointerdown', startDrag);
    els.graph.addEventListener('pointermove', moveDrag);
    els.graph.addEventListener('pointerup', endDrag);
    els.graph.addEventListener('pointercancel', endDrag);
    els.graph.addEventListener('wheel', handleWheel, { passive: false });
    els.graph.addEventListener('keydown', handleMapKeys);
    els.zoomInBtn.addEventListener('click', () => zoomBy(ZOOM_STEP));
    els.zoomOutBtn.addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
    els.fitBtn.addEventListener('click', () => fit());
    els.searchInput.addEventListener('input', handleSearch);
    els.searchInput.addEventListener('keydown', handleSearchKeys);
    els.typeFilters.addEventListener('change', handleFilterChange);
    els.inferredToggle.addEventListener('change', () => {
      state.showInferred = els.inferredToggle.checked;
      redraw();
      renderDetails();
    });
    els.helpBtn.addEventListener('click', () => els.helpDialog.showModal());
    els.helpDialog.addEventListener('click', (event) => {
      if (event.target === els.helpDialog || event.target.closest('[data-close]')) els.helpDialog.close();
    });
    els.themeBtn.addEventListener('click', cycleTheme);
    document.addEventListener('keydown', handleShortcuts);
  }

  /** Start: theme, project name, filters, layout, overview, health. */
  function init() {
    applyTheme(readTheme());
    const project = (DATA.meta && DATA.meta.project) || 'project';
    els.projectName.textContent = project;
    document.title = `${project} — Atlas code map`;
    buildFilters();
    bindEvents();
    redraw();
    fit();
    renderDetails();
    renderHealth();
  }

  init();
})();
