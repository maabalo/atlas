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
| `python3 atlas.py uses PROJECT NAME` | What uses NAME? (who calls it, loads it, styles it) |
| `python3 atlas.py deps PROJECT NAME` | What does NAME use? |
| `python3 atlas.py explain PROJECT NAME` | Both, plus where NAME is defined. |
| `python3 atlas.py path PROJECT A B` | The shortest chain of links between A and B. |
| `python3 atlas.py hubs PROJECT [-n 10]` | The most-connected functions and classes. These are the riskiest to change. |
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

Each type of thing has its own **shape** as well as its own colour:

| Shape | Meaning |
|---|---|
| ■ square | a file |
| ● circle | a function (bigger means more connected) |
| ◆ diamond | a Python class |
| ▲ triangle | an HTML id (hidden at first: tick **html ids**) |
| ○ ring | a CSS class (hidden at first: tick **css classes**) |

- **Click a shape**, or **search** for it, to see everything that uses it and everything it uses. Click any row to jump there.
- **Drag** to move around. **Scroll** or use **+ / −** to zoom, and **⛶** to fit the whole map.
- **Keyboard:**
  - `/` search
  - `Esc` clear the selection
  - `?` help
  - on the map: arrow keys pan, `+` and `-` zoom, `0` fits the whole map
- The **health** panel lists possible problems. Click one to find it on the map.

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

Even so, **treat health results as "check this"**, not "delete this".

---

## How it works

| File | Job |
|---|---|
| `atlas_scan.py` | Reads each file. Python is parsed exactly with `ast`, and HTML with `html.parser`. JS and CSS use careful pattern matching: comments and strings are blanked first, and template literals are handled at any depth. |
| `atlas_graph.py` | Builds the graph: nodes, links, certainty, queries, health checks. |
| `atlas_export.py` | Writes the JSON, the Markdown report and the single-file HTML map. |
| `atlas.py` | The command line. |
| `viewer/` | The map page template: `index.html`, `style.css`, `app.js`. It uses no libraries; the layout is a small force simulation. |
| `tests/` | `test_atlas.py`, plus `fixture/`, a tiny project where every tricky case has a known answer. |

Atlas skips these folders:
- `node_modules`, `.git` and `__pycache__`
- virtual environments
- `dist` and `build`
- its own `maps/`

It also skips files over 2 MB, which are almost always generated or minified.

## Checks (for development)

```sh
python3 -m unittest discover -s tests -v   # 33 tests, no network
ruff check . && ruff format --check .      # Python style (pyproject.toml)
npm install && npm run lint                # viewer: html-validate, stylelint, ESLint, Prettier
```

`maps/` is in `.gitignore`, because a map lists the names inside a project, which may be private.

## License

[MIT](LICENSE): free to use, change and share, with credit. No warranty.
