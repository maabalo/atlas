# Atlas — a map of your code

Atlas reads a project (Python, JavaScript, HTML and CSS) and maps how it fits together:
**which function calls which, which file loads which, and which code uses each HTML id and CSS class.**
Ask it a question in the Terminal, or open the interactive map in your browser.

- **Before you change something:** `uses` shows everything that depends on it.
- **To find dead code:** `check` lists functions nothing calls, CSS nothing uses, and ids that don't exist.
- **To learn a codebase:** `hubs` shows the most-connected functions, and the map shows the shape of the whole thing.

It's private and has nothing to install: it uses only Python's standard library (Python 3.9+), makes no network calls while mapping (the map page only loads two web fonts from Google, and uses built-in fonts offline), and **never writes into your project**. Maps are saved in Atlas's own `maps/` folder.

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

## The Mac app

Prefer double-clicking? Build `Atlas.app` once with `sh packaging/build_app.sh` (it needs Python and an internet connection to fetch PyInstaller), then open `dist/Atlas.app`. Double-click it and it rebuilds one combined map of the projects in `~/Documents/Project`, then opens it in your browser. Claude's own folder (`~/.claude`: settings, skills, memory, plugins and saved conversations) is added as Claude's **core**: a small dust ball at the centre of the globe, seen through it and turning the other way (`--satellite`). A glowing **nucleus** sits at its centre with **fine curved strands** bursting out to every file and folder (warm near the nucleus, blue at the tip; strands near the cursor bend aside; they grow out once when the map opens). The brightest strands go to every file Claude has edited or created, read from Claude Code's session logs (`--claude-log ~/.claude/projects`: only the Edit/Write tool names and file paths are read, nothing else; files changed through scripts aren't named in the logs, so they get no ray). Point at a file to see "Claude: edited 12×". Saved conversations, file history, caches, session files and backups are left out of the core (`--satellite-skip PATTERN`, repeatable); only file names and the code inside Python/JavaScript/HTML/CSS files go into the map, never the text of your notes or conversations. On a Mac without that folder, it asks which folder to map. The app doesn't need Python to run. Maps are saved in `~/Library/Application Support/Atlas/maps/`, never in your project.

The app isn't notarized by Apple, so if you copy it to another Mac, the first launch needs right-click → **Open** (or approval in System Settings → Privacy & Security). The build runs only on the kind of Mac that built it (Apple silicon or Intel).

## Commands

Run them from the Atlas folder. `PROJECT` is the path to any project folder.

| Command | What it answers |
|---|---|
| `python3 atlas.py build PROJECT` | Makes the map: `graph.html`, `GRAPH_REPORT.md` and `graph.json` in `maps/PROJECT/`. Add `--open` to open it in the browser, or `--out FOLDER` to save it somewhere else. |
| `python3 atlas.py build P1 P2 … --name NAME` | One **combined map** of several projects in `maps/NAME/`. Each project becomes its own island (a band of dust on the globe), and every path starts with the project's folder name (`my_site/assets/js/app.js`), so projects never link to each other by accident. Two projects can't share a folder name. |
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

The map is a **globe** in deep space, with a faint grid of **100 rows and 100 columns**. Every **folder**, **file** (images, docs and data too, skipping junk like `.git`, `node_modules` and caches) and **piece of code** (functions, classes, HTML ids, CSS classes) is a tiny speck of **dust**, scattered over the globe (not on the grid lines): each **folder sits in the middle of its files and subfolders**, in rings, and each file is surrounded by its code. Each project starts from its own spot on the globe. It stays dark in the light theme too (the panels around it follow the theme).

| Dust | Meaning |
|---|---|
| off-white (bigger) | a folder |
| a pastel by language (bigger) | a file: Python pastel blue, JavaScript butter yellow, TypeScript baby blue, HTML peach, CSS lavender, Markdown mint, JSON pastel gold, shell pastel green; anything else soft grey |
| the same colour, smaller | a function, class, HTML id or CSS class in that file |

The key at the top left of the map lists each language with its number of files (folded on phones). **Click a language** to see where it's used: its files, their links and the files at the other end stay bright and the globe turns toward them (click again or Esc to clear). Dust on the far side of the globe is dimmer.

- **Panel:** one panel, on the right, hidden at first so the globe fills the window. The panel button at the top right (or `/`) shows it: search at the top, then the folders, the numbers and the health checks.
- **Folders list:** under the search box, closed at first: click one to show the files inside it. Picking a folder or file glides the globe round until it faces you.
- **Numbers:** in the panel, under the folders. **Click a kind** (functions, html ids…) to light up those items and whatever declares or uses them; their names appear on the globe where they fit. Click again or Esc to clear.
- **Links** aren't drawn: clicking a speck lights up what it's linked to, and picking a language or kind shows where it's used.
- **Web view:** the **globe | web** switch at the top (or **V**) shows folders and files as a flat web (like graphify's): lines join folders to what's inside them and files to the files they use; it's all fine dust, with each file's code parts floating round it in a little cloud, and better-linked specks a little bigger. It settles by itself, then stays still. Drag empty space to move, drag a dot to pull it.
- **Spin:** the globe turns slowly on its own axis (about once in 10½ minutes) and Claude's core turns slowly the other way. The spin button at the top, or **S**, stops and starts both; it starts off when the Mac asks for less motion.
- **Click a speck**, or **search** for it, to highlight it and what it's linked to; it and a few neighbours are named. **Pointing at a speck** rings it and shows what it is (name, language, how many files, code parts or links). The address keeps the selection (`#star=…`), so a link reopens the map on it.
- **Turning:** **drag** or the **arrow keys** turn the globe, always around its own centre; **Shift** + drag or **Shift** + arrows slide it across the screen. Selecting something turns the globe until it faces you. It only moves when you move it.
- **Keyboard:**
  - `/` search
  - `Esc` clear the selection
  - `?` help
  - on the map: arrow keys turn (`Shift` + arrows pan; in 2D they pan), `+` and `-` zoom, `0` fits the whole map
- **Health** (in the panel, under the numbers) lists possible problems. Click one to find it on the map.

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
| `viewer/` | The map page template: `index.html`, `style.css`, `core.js` (the pure maths, colours and web physics, tested on its own) and `app.js` (drawing and controls). Maps get a Content-Security-Policy that only allows their own inline code (by hash) and Google Fonts. It uses no libraries: every node is placed on a 100 × 100 grid globe (folders surrounded by their files), painted on one `<canvas>` with its own perspective, only when something moves. |
| `tests/` | `test_atlas.py`, plus `fixture/`, a tiny project where every tricky case has a known answer. |

Atlas skips these folders:
- `node_modules`, `.git` and `__pycache__`
- virtual environments
- `dist` and `build`
- its own `maps/`

It also skips files over 2 MB, which are almost always generated or minified.

## Checks (for development)

```sh
python3 -m unittest discover -s tests -v   # 64 tests, no network
node --test tests/core.test.js             # 11 tests for viewer/core.js (Node's built-in runner, nothing to install)
ruff check . && ruff format --check .      # Python style (pyproject.toml)
npm install && npm run lint                # viewer: html-validate, stylelint, ESLint, Prettier
```

`maps/` is in `.gitignore`, because a map lists the names inside a project, which may be private.

## License

[MIT](LICENSE): free to use, change and share, with credit. No warranty.
