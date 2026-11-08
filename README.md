# Atlas — a map of your code

Atlas reads a project (Python, JavaScript, HTML and CSS) and maps how it fits together:
**which function calls which, which file loads which, and which code uses each HTML id and CSS class.**
Ask it a question in the Terminal, or open the interactive map in your browser.

- **Before you change something:** `uses` shows everything that depends on it.
- **To find dead code:** `check` lists functions nothing calls, CSS nothing uses, and ids that don't exist.
- **To learn a codebase:** `hubs` shows the most-connected functions, and the map shows the shape of the whole thing.

It's private and has nothing to install: it uses only Python's standard library (Python 3.9+), makes no network calls, and **never writes into your project**. Maps are saved in Atlas's own `maps/` folder.

```
$ python3 atlas.py uses ~/projects/qr-generator renderCode
function  renderCode  (assets/js/app.js:795)
is used by:
  calls    function  init  (assets/js/app.js:1551)
  declares file      assets/js/app.js
  uses     function  scheduleRender  (assets/js/app.js:789)
```

---

## Get it

You need **Python 3.9 or newer** (macOS: `python3 --version` in Terminal). Nothing else.

```sh
git clone https://github.com/maabalo/atlas.git   # or: Code → Download ZIP on GitHub
cd atlas
python3 atlas.py build ~/path/to/your/project --open
```
On Windows, use `python` instead of `python3`.

## Commands

Run them from the Atlas folder. `PROJECT` is the path to any project folder.

| Command | What it answers |
|---|---|
| `python3 atlas.py build PROJECT` | Makes the map: `graph.html`, `GRAPH_REPORT.md` and `graph.json` in `maps/PROJECT/`. Add `--open` to open it in the browser, or `--out FOLDER` to save it somewhere else. |
| `python3 atlas.py build P1 P2 … --name NAME` | One **combined map** of several projects in `maps/NAME/`. Each project becomes its own island with its name over it, and every path starts with the project's folder name (`my_site/assets/js/app.js`), so projects never link to each other by accident. Two projects can't share a folder name. |
| `python3 atlas.py uses PROJECT NAME` | What uses NAME? (who calls it, loads it, styles it) |
| `python3 atlas.py deps PROJECT NAME` | What does NAME use? |
| `python3 atlas.py explain PROJECT NAME` | Both, plus where NAME is defined. |
| `python3 atlas.py path PROJECT A B` | The shortest chain of links between A and B. |
| `python3 atlas.py hubs PROJECT [-n 10]` | The most-connected functions and classes. These are the riskiest to change. |
| `python3 atlas.py communities PROJECT [-n 15]` | The **subsystems**: groups of code linked mostly to each other (Louvain method), biggest first, each named after its main file and hubs, e.g. `cloud.js — db · auth`. |
| `python3 atlas.py check PROJECT` | Health checks. The exit code is `3` if anything is found, so you can run it before committing. |

**NAME** can be:
- a function (`renderCode`)
- a method (`DistillHandler.send_event`)
- a file (`app.js`)
- an HTML id (`#textInput`)
- a CSS class (`.qr-frame`)

If a name matches more than one thing, Atlas lists their exact ids so you can pick one.

```
$ python3 atlas.py hubs ~/projects/qr-generator -n 3
    13 links  showToast  (assets/js/app.js:1396)
    12 links  init  (assets/js/app.js:1551)
    12 links  encode  (assets/js/qrcode.js:610)

$ python3 atlas.py check ~/projects/distill
unused functions: none ✓
unused css classes: 3
  .dialog--wide  (web/assets/css/style.css:845)
  .dialog-title  (web/assets/css/style.css:882)
  .help-note  (web/assets/css/style.css:940)
missing ids: none ✓
```

---

## The interactive map (`graph.html`)

`graph.html` is a single file. It opens straight from Finder, works offline, and you can send it to someone.

The map looks like a **galaxy**: deep space with scattered stars and faint nebulae, each dot glowing in its own colour, and links as faint light trails. It stays dark in the light theme too (the panels around it follow the theme).

Each type of thing has its own **shape** as well as its own colour:

| Shape | Meaning |
|---|---|
| ■ square | a file |
| ● circle | a function (bigger means more connected) |
| ◆ diamond | a Python class |
| ▲ triangle | an HTML id (hidden at first: tick **html ids**) |
| ○ ring | a CSS class (hidden at first: tick **css classes**) |

- **Communities:** the overview lists the biggest; click one to fit the map to it. Tick **community colours** to colour the dots by community (their shapes still show their type). Selecting a dot shows its community too.
- **Labels** are hidden at first, to keep the map calm. Tick **labels** to show file, hub and project names. The selected shape and its neighbours are always named, and pointing at a dot shows its name.
- **Click a shape**, or **search** for it, to see everything that uses it and everything it uses. Click any row to jump there.
- **Drag** to move around. **Scroll** or use **+ / −** to zoom, and **⛶** to fit the whole map.
- **3D (the default):** the map opens spread out in depth, drawn in perspective (nearer shapes are bigger and cover farther ones). **Drag** or the **arrow keys** turn it; **Shift** + drag or **Shift** + arrows pan. The **3D** button switches to the flat 2D map and back. In a combined map the projects' islands sit around a sphere, so no angle stacks them up.
- **Keyboard:**
  - `/` search
  - `Esc` clear the selection
  - `?` help
  - on the map: arrow keys turn (`Shift` + arrows pan; in 2D they pan), `+` and `-` zoom, `0` fits the whole map
- The **health** panel lists possible problems. Click one to find it on the map.

## Ask Atlas from Claude Code (MCP server)

`atlas_mcp.py` lets Claude Code (or any MCP client) ask Atlas directly, instead of searching through files. It uses only the standard library, it's **read-only**, and it maps only projects inside the folders you give it with `--root` (repeatable; default: the folder it starts in).

```sh
claude mcp add atlas -- python3 /full/path/to/atlas/atlas_mcp.py --root ~/projects
```

Then `/mcp` in Claude Code shows its tools:

| Tool | What it answers |
|---|---|
| `atlas_overview` | Counts, biggest hubs, communities and health of a project: a good first question |
| `atlas_explain` | Everything about one thing: where it is, its community, what uses it, what it uses |
| `atlas_uses` / `atlas_deps` | What uses NAME / what NAME uses |
| `atlas_path` | The shortest chain of links between two things |
| `atlas_hubs` | The most-connected functions and classes |
| `atlas_communities` | The subsystems, biggest first |
| `atlas_check` | Health checks |

Every argument is checked (types, lengths, limits, the allowed folders) before anything is read, and long answers are cut at 300 lines.

## Certain vs. inferred links

| Certain | Inferred |
|---|---|
| Written in the code: `renderCode()`, `getElementById('output')`, `<script src="app.js">`, `helpers.tidy()`, `self.save()` | Matched by name, so likely but not guaranteed: a function in another JS file with that unique name, `obj.greet()` where the type of `obj` isn't known, or a JS string like `'is-active'` that matches a CSS class |

`GRAPH_REPORT.md` and the CLI mark inferred links. On the map, they're dashed and can be hidden.

## What the health checks can't see

Atlas reads code; it doesn't run it. So a name **built at runtime** can be invisible to it, such as `window['render' + type]()` or `getattr(obj, name)`. Atlas already allows for the common cases:
- template literals
- class-name prefixes like `` `theme--${mode}` ``
- `unittest` methods
- `http.server` hooks such as `do_GET`
- `__dunder__` methods
- `main`
- classes from libraries the page loads: with `…/leaflet.css`, classes like `.leaflet-tile-pane` belong to Leaflet (and with `maplibre-gl.css`, `.maplibregl-…` ones belong to MapLibre)

Even so, **treat health results as "check this"**, not "delete this".

---

## How it works

| File | Job |
|---|---|
| `atlas_scan.py` | Reads each file. Python is parsed exactly with `ast`, and HTML with `html.parser`. JS and CSS use careful pattern matching: comments and strings are blanked first, and template literals are handled at any depth. |
| `atlas_graph.py` | Builds the graph: nodes, links, certainty, queries, health checks, communities (Louvain, run on each connected part separately, so projects in a combined map get the same groups as on their own). |
| `atlas_export.py` | Writes the JSON, the Markdown report and the single-file HTML map. |
| `atlas.py` | The command line. Its answers are text lines, shared with the MCP server. |
| `atlas_mcp.py` | The MCP server (JSON-RPC 2.0 over stdio, written by hand: no SDK needed). |
| `viewer/` | The map page template: `index.html`, `style.css`, `app.js`. It uses no libraries; the layout is a small force simulation (in 2D or 3D), and the 3D view is plain SVG with its own perspective maths. Links are weakened by how many links their ends have (like d3), so a hub with dozens of links can't push the layout apart. |
| `tests/` | `test_atlas.py`, plus `fixture/`, a tiny project where every tricky case has a known answer. |

Atlas skips these folders:
- `node_modules`, `.git` and `__pycache__`
- virtual environments
- `dist` and `build`
- its own `maps/`

It also skips files over 2 MB, which are almost always generated or minified.

## Checks (for development)

```sh
python3 -m unittest discover -s tests -v   # 50 tests, no network
ruff check . && ruff format --check .      # Python style (pyproject.toml)
npm install && npm run lint                # viewer: html-validate, stylelint, ESLint, Prettier
```

`maps/` is in `.gitignore`, because a map lists the names inside a project, which may be private.

## License

[MIT](LICENSE): free to use, change and share, with credit. No warranty.
