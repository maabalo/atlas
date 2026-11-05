"""
Atlas — atlas_scan.py: read source files and extract "facts".

Each scanner turns one file into a FileFacts record: what it defines
(functions, classes, HTML ids, CSS classes) and what it refers to
(calls, imports, loaded files, ids and classes it uses). atlas_graph.py
then links the facts of all files into one graph.

Only Python's standard library is used:
  - Python: the real parser (ast), so results are exact.
  - HTML:   html.parser.
  - JS/CSS: small scanners. Comments and string contents are blanked out
            first so they can't be mistaken for code. Limits: JS class
            methods and dynamic names (obj[name]()) aren't followed, so
            those links can be missing — see README "Limits".

TABLE OF CONTENTS
  01  Settings & the FileFacts record
  02  Finding files
  03  Python (ast)
  04  HTML (html.parser)
  05  CSS
  06  JavaScript: blanking comments & strings
  07  JavaScript: definitions, scopes & references
  08  JavaScript: ids & classes used from code
"""

from __future__ import annotations

import ast
import os
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

# =============================================================================
# 01  SETTINGS & THE FileFacts RECORD
# =============================================================================
LANGUAGES = {".py": "python", ".js": "javascript", ".mjs": "javascript", ".html": "html", ".htm": "html", ".css": "css"}
SKIP_DIRS = {"node_modules", "__pycache__", ".git", ".venv", "venv", "dist", "build", ".ruff_cache", "maps"}
MAX_FILE_BYTES = 2_000_000  # bigger files are almost always generated or vendored
JS_KEYWORDS = {
    "if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "await", "async",
    "do", "else", "try", "finally", "throw", "case", "delete", "void", "in", "of", "instanceof", "yield",
    "super", "this", "class", "const", "let", "var", "import", "export", "default", "extends",
}  # fmt: skip


@dataclass
class Definition:
    """A function or class defined in a file. `qualname` is unique within the file."""

    kind: str  # "function" | "class"
    name: str
    qualname: str
    line: int


@dataclass
class Reference:
    """A use of a name inside `scope` (a qualname, or "" for file-level code)."""

    scope: str
    name: str
    line: int
    is_call: bool  # name(...) — otherwise passed around, e.g. addEventListener('click', name)
    module: str = ""  # Python: the module the name was accessed through (core.summarize → "summarize")
    method: bool = False  # Python: obj.name on an object of unknown type (matched by method name, inferred)


@dataclass
class FileFacts:
    """Everything one file defines and refers to. Paths are relative to the project, with "/"."""

    path: str
    lang: str
    definitions: list[Definition] = field(default_factory=list)
    references: list[Reference] = field(default_factory=list)
    imports: list[tuple[str, int]] = field(default_factory=list)  # (module name, line)
    loads: list[tuple[str, int]] = field(default_factory=list)  # (relative file path, line)
    ids_declared: list[tuple[str, int]] = field(default_factory=list)
    ids_used: list[tuple[str, int, bool]] = field(default_factory=list)  # (id, line, certain?)
    classes_declared: list[tuple[str, int]] = field(default_factory=list)  # CSS: classes styled
    classes_used: list[tuple[str, int, bool]] = field(default_factory=list)  # (class, line, certain?)
    strings: set[str] = field(default_factory=set)  # JS string tokens, matched against known ids/classes later
    libraries: set[str] = field(default_factory=set)  # external CSS/JS libraries: ".../leaflet.css" → "leaflet"
    error: str = ""  # set when the file couldn't be parsed


def line_of(text: str, offset: int) -> int:
    """1-based line number of a character offset."""
    return text.count("\n", 0, offset) + 1


# =============================================================================
# 02  FINDING FILES
# =============================================================================
def find_source_files(root: Path) -> list[Path]:
    """Source files under root, skipping dependencies, caches, hidden folders and minified code."""
    found = []
    for folder, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith("."))
        for name in sorted(files):
            path = Path(folder) / name
            if path.suffix.lower() in LANGUAGES and ".min." not in name and path.stat().st_size <= MAX_FILE_BYTES:
                found.append(path)
    return found


def scan_file(path: Path, root: Path) -> FileFacts:
    """Read and scan one file with the scanner for its language."""
    lang = LANGUAGES[path.suffix.lower()]
    facts = FileFacts(path=path.relative_to(root).as_posix(), lang=lang)
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as error:
        facts.error = f"couldn't read: {error.strerror}"
        return facts
    scanner = {"python": scan_python, "html": scan_html, "css": scan_css, "javascript": scan_javascript}[lang]
    scanner(text, facts, path, root)
    return facts


# =============================================================================
# 03  PYTHON (ast — exact)
# =============================================================================
def scan_python(text: str, facts: FileFacts, path: Path, root: Path) -> None:
    """Functions, classes, methods, imports, and every name each one uses."""
    try:
        tree = ast.parse(text)
    except SyntaxError as error:
        facts.error = f"syntax error on line {error.lineno}"
        return
    aliases = python_imports(tree, facts)
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            facts.definitions.append(Definition("class", node.name, node.name, node.lineno))
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    add_python_function(item, f"{node.name}.{item.name}", node.name, facts, aliases)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            add_python_function(node, node.name, "", facts, aliases)
    top_level = [n for n in tree.body if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
    for statement in top_level:
        python_references(statement, "", "", facts, aliases)


def python_imports(tree: ast.Module, facts: FileFacts) -> dict[str, str]:
    """Record imports; return {local name: "module" or "module.name"} for resolving uses."""
    aliases = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                facts.imports.append((alias.name, node.lineno))
                aliases[alias.asname or alias.name.split(".")[0]] = alias.name
        elif isinstance(node, ast.ImportFrom):
            module = absolute_module(node, facts.path)
            facts.imports.append((module, node.lineno))
            for alias in node.names:
                # `from pkg import helpers` may import a module: record it too (unknown names are ignored)
                facts.imports.append((f"{module}.{alias.name}".lstrip("."), node.lineno))
                aliases[alias.asname or alias.name] = f"{module}.{alias.name}".lstrip(".")
    return aliases


def absolute_module(node: ast.ImportFrom, path: str) -> str:
    """The dotted module of a `from ... import`; relative ones (`from .x`) are resolved against the file's folder."""
    if node.level == 0:
        return node.module or ""
    package = path.split("/")[:-1]  # pkg/sub/mod.py → ["pkg", "sub"]
    package = package[: len(package) - (node.level - 1)] if node.level > 1 else package
    return ".".join([*package, *([node.module] if node.module else [])])


def add_python_function(node, qualname: str, class_name: str, facts: FileFacts, aliases: dict) -> None:
    """A function or method, plus the names its body uses (nested functions count as its body)."""
    facts.definitions.append(Definition("function", node.name, qualname, node.lineno))
    extras = node.args.defaults + [d for d in node.args.kw_defaults if d] + node.decorator_list
    for statement in node.body + extras:
        python_references(statement, qualname, class_name, facts, aliases)


def python_references(node: ast.AST, scope: str, class_name: str, facts: FileFacts, aliases: dict) -> None:
    """Every function name used under `node`: calls, callbacks, module.function and self.method."""
    called = {id(n.func) for n in ast.walk(node) if isinstance(n, ast.Call)}
    for child in ast.walk(node):
        is_call = id(child) in called
        if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Load):
            target = aliases.get(child.id, "")
            module, _, name = target.rpartition(".") if "." in target else ("", "", child.id)
            facts.references.append(Reference(scope, name, child.lineno, is_call, module))
        elif isinstance(child, ast.Attribute):
            owner = child.value.id if isinstance(child.value, ast.Name) else ""
            if owner in ("self", "cls") and class_name:
                facts.references.append(Reference(scope, f"{class_name}.{child.attr}", child.lineno, is_call))
            elif owner in aliases:  # module.function, or an imported class's attribute
                facts.references.append(Reference(scope, child.attr, child.lineno, is_call, aliases[owner]))
            else:  # some_object.method(): type unknown, so it's matched by method name later
                facts.references.append(Reference(scope, child.attr, child.lineno, is_call, method=True))


# =============================================================================
# 04  HTML (html.parser)
# =============================================================================
ID_LIST_ATTRIBUTES = {"for", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "form", "list"}


class _HtmlScanner(HTMLParser):
    """Collects ids, classes, loaded scripts/stylesheets and id references from markup."""

    def __init__(self, facts: FileFacts, base: Path, root: Path):
        """`base` is the HTML file's folder (for resolving src/href); `root` is the project."""
        super().__init__(convert_charrefs=True)
        self.facts, self.base, self.root = facts, base, root

    def handle_starttag(self, tag, attrs):
        """One opening tag: record what it declares, uses and loads."""
        line = self.getpos()[0]
        values = {name: (value or "") for name, value in attrs}
        if values.get("id"):
            self.facts.ids_declared.append((values["id"], line))
        for name in values.get("class", "").split():
            self.facts.classes_used.append((name, line, True))
        self.id_references(values, line)
        self.loaded_file(tag, values, line)

    handle_startendtag = handle_starttag

    def id_references(self, values: dict, line: int) -> None:
        """for=, aria-*= and href="#id" all point at ids (but "#/camps" and "#!/x" are app routes)."""
        for name in ID_LIST_ATTRIBUTES & values.keys():
            for ref in values[name].split():
                self.facts.ids_used.append((ref, line, True))
        href = values.get("href", "")
        fragment = href[1:] if href.startswith("#") else ""
        if fragment and not fragment.startswith(("/", "!")):
            self.facts.ids_used.append((fragment, line, True))

    def loaded_file(self, tag: str, values: dict, line: int) -> None:
        """<script src> and <link rel="stylesheet" href> that point at files in this project."""
        ref = values.get("src") if tag == "script" else values.get("href") if tag == "link" else None
        if tag == "link" and "stylesheet" not in values.get("rel", ""):
            return
        if not ref:
            return
        if re.match(r"^[a-z]+:|^//", ref):  # external (https:, data:…): not ours, but remember the library's name
            if library_name(ref):
                self.facts.libraries.add(library_name(ref))
            return
        target = (self.base / ref.split("?")[0].split("#")[0]).resolve()
        if target.is_file() and self.root in target.parents:
            self.facts.loads.append((target.relative_to(self.root).as_posix(), line))


def library_name(url: str) -> str:
    """A library's name from its file URL: ".../leaflet.min.css" → "leaflet"; "" when it isn't .css/.js."""
    last = url.split("?")[0].split("#")[0].rstrip("/").rsplit("/", 1)[-1].lower()
    match = re.fullmatch(r"([a-z][a-z0-9-]{2,})(?:\.min)?\.(?:css|js|mjs)", last)
    return match.group(1) if match else ""


def scan_html(text: str, facts: FileFacts, path: Path, root: Path) -> None:
    """Parse markup; inline <script> code isn't analysed (Atlas follows external files)."""
    scanner = _HtmlScanner(facts, path.parent, root.resolve())
    try:
        scanner.feed(text)
        scanner.close()
    except Exception as error:  # html.parser is forgiving; this only guards against the unexpected
        facts.error = f"couldn't parse HTML: {error}"


# =============================================================================
# 05  CSS
# =============================================================================
CSS_CLASS = re.compile(r"\.(-?[_a-zA-Z][\w-]*)")
CSS_ID = re.compile(r"#(-?[_a-zA-Z][\w-]*)")


def scan_css(text: str, facts: FileFacts, path: Path, root: Path) -> None:
    """Classes and ids appearing in selectors (not in property values like colors or urls)."""
    clean = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group()), text, flags=re.S)
    start = 0
    for match in re.finditer(r"[{};]", clean):
        prelude = clean[start : match.start()]
        if match.group() == "{" and not prelude.strip().startswith("@"):
            selector = re.sub(r"\[[^\]]*\]|'[^']*'|\"[^\"]*\"", " ", prelude)  # drop [attr="x.y"] parts
            line = line_of(clean, start + len(prelude) - len(prelude.lstrip()))
            facts.classes_declared += [(name, line) for name in CSS_CLASS.findall(selector)]
            facts.ids_used += [(name, line, True) for name in CSS_ID.findall(selector)]
        start = match.end()


# =============================================================================
# 06  JAVASCRIPT: BLANKING COMMENTS & STRINGS
# Comments and string contents become spaces (newlines kept), so line
# numbers stay right and nothing inside them looks like code. String
# contents are collected separately for section 08.
# =============================================================================
def blank_js(text: str) -> tuple[str, list[tuple[str, int]]]:
    """(code with comments/strings blanked, [(string content, offset)]).

    A stack tracks nesting: code → `template` → ${ code } → `template` …, so the code
    inside ${…} stays visible at any depth while all literal text is blanked."""
    out, strings, stack, i = list(text), [], [], 0  # stack items: {"lit": start} or {"depth": n}
    while i < len(text):
        if stack and "lit" in stack[-1]:
            i = step_template(text, i, out, strings, stack)
        else:
            i = step_code(text, i, out, strings, stack)
    return "".join(out), strings


def step_code(text: str, i: int, out: list, strings: list, stack: list) -> int:
    """Advance one token in code: comments, strings, template starts, and ${…} braces."""
    two = text[i : i + 2]
    if two in ("//", "/*"):
        end = text.find("\n" if two == "//" else "*/", i + 2)
        end = len(text) if end == -1 else end + (0 if two == "//" else 2)
        blank_range(text, out, i, end)
        return end
    if text[i] in "'\"":
        end = string_end(text, i)
        strings.append((text[i + 1 : end - 1], i))
        blank_range(text, out, i, end)
        return end
    if text[i] == "`":
        blank_range(text, out, i, i + 1)
        stack.append({"lit": i + 1})
    elif text[i] in "{}" and stack:  # braces only matter inside a ${…} region
        step_brace(text, i, out, stack)
    return i + 1


def step_brace(text: str, i: int, out: list, stack: list) -> None:
    """A brace inside ${…}: count nesting; the "}" that closes ${ returns to the template text."""
    frame = stack[-1]
    if text[i] == "{":
        frame["depth"] += 1
    elif frame["depth"] == 0:
        blank_range(text, out, i, i + 1)
        stack[-1] = {"lit": i + 1}
    else:
        frame["depth"] -= 1


def step_template(text: str, i: int, out: list, strings: list, stack: list) -> int:
    """Advance one character inside template text: escapes, ${ and the closing backtick."""
    frame = stack[-1]
    if text[i] == "\\":
        blank_range(text, out, i, i + 2)
        return i + 2
    if text[i] == "`" or text.startswith("${", i):
        strings.append((text[frame["lit"] : i], frame["lit"]))
        width = 1 if text[i] == "`" else 2
        blank_range(text, out, i, i + width)
        if width == 1:
            stack.pop()
        else:
            stack[-1] = {"depth": 0}
        return i + width
    blank_range(text, out, i, i + 1)
    return i + 1


def blank_range(text: str, out: list, start: int, end: int) -> None:
    """Replace text[start:end] with spaces in `out`, keeping newlines."""
    for j in range(max(start, 0), min(end, len(text))):
        out[j] = "\n" if text[j] == "\n" else " "


def string_end(text: str, start: int) -> int:
    """Offset just after the string that opens at `start` (handles escapes; `${}` is kept simple)."""
    quote, i = text[start], start + 1
    while i < len(text):
        if text[i] == "\\":
            i += 2
            continue
        if text[i] == quote or (text[i] == "\n" and quote != "`"):
            return i + 1
        i += 1
    return len(text)


def matching_brace(code: str, open_at: int) -> int:
    """Offset of the "}" that closes the "{" at open_at (code must already be blanked)."""
    depth = 0
    for i in range(open_at, len(code)):
        if code[i] == "{":
            depth += 1
        elif code[i] == "}":
            depth -= 1
            if depth == 0:
                return i
    return len(code) - 1


# =============================================================================
# 07  JAVASCRIPT: DEFINITIONS, SCOPES & REFERENCES
# Named functions (function f / const f = () => / const f = function) are
# nodes. Functions nested inside another named function belong to it.
# =============================================================================
JS_FUNCTION = re.compile(r"\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(")
JS_ASSIGNED = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?"  # const name = [async]
    r"(?:function\b[^(]*\(|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)"  # function (…) | (…) => | x =>
)
JS_IDENTIFIER = re.compile(r"(?<![\w$])(?:(?<=\.\.\.)|(?<!\.))([A-Za-z_$][\w$]*)(?![\w$])")
JS_CALL_AFTER = re.compile(r"\s*\(")


def scan_javascript(text: str, facts: FileFacts, path: Path, root: Path) -> None:
    """Top-level named functions, then every identifier, attributed to its enclosing function."""
    code, strings = blank_js(text)
    scopes = js_function_scopes(code)
    for name, _start, _end, line in scopes:
        facts.definitions.append(Definition("function", name, name, line))
    for match in JS_IDENTIFIER.finditer(code):
        name = match.group(1)
        if name in JS_KEYWORDS:
            continue
        scope = enclosing_scope(scopes, match.start())
        if scope and scope[1] == match.start():  # the definition's own name
            continue
        is_call = JS_CALL_AFTER.match(code, match.end()) is not None
        facts.references.append(Reference(scope[0] if scope else "", name, line_of(code, match.start()), is_call))
    js_dom_usage(strings, text, facts)


def js_function_scopes(code: str) -> list[tuple[str, int, int, int]]:
    """[(name, name offset, body end, line)] for named functions not nested in another one."""
    found = []
    for pattern in (JS_FUNCTION, JS_ASSIGNED):
        for match in pattern.finditer(code):
            found.append((match.group(1), match.start(1), body_end(code, match.end()), line_of(code, match.start(1))))
    found.sort(key=lambda item: item[1])
    outer = []
    for item in found:
        if not any(o[1] < item[1] <= o[2] for o in outer):
            outer.append(item)
    return outer


def body_end(code: str, after: int) -> int:
    """End of a function body: the matching "}" — or, for `x => expr`, the end of the statement.
    `after` is just past "(" (function …( ) or just past "=>" (arrow functions)."""
    i = matching_paren(code, after - 1) + 1 if code[after - 1] == "(" else after
    i = skip_space(code, i)
    if code.startswith("=>", i):  # function(x) … never has "=>", but `const f = function` paths share this
        i = skip_space(code, i + 2)
    if i < len(code) and code[i] == "{":
        return matching_brace(code, i)
    depth = 0
    for j in range(i, len(code)):
        depth += code[j] in "([{"
        depth -= code[j] in ")]}"
        if depth < 0 or (depth == 0 and code[j] == ";"):
            return j
    return len(code) - 1


def matching_paren(code: str, open_at: int) -> int:
    """Offset of the ")" that closes the "(" at open_at."""
    depth = 0
    for i in range(open_at, len(code)):
        depth += code[i] == "("
        depth -= code[i] == ")"
        if depth == 0:
            return i
    return len(code) - 1


def skip_space(code: str, i: int) -> int:
    """First non-whitespace offset at or after i."""
    while i < len(code) and code[i].isspace():
        i += 1
    return i


def enclosing_scope(scopes: list, offset: int):
    """The named function whose span contains `offset`, or None for file-level code."""
    for scope in scopes:
        if scope[1] <= offset <= scope[2]:
            return scope
    return None


# =============================================================================
# 08  JAVASCRIPT: IDS & CLASSES USED FROM CODE
# Certain:  getElementById('x'), querySelector('#x .y'), classList.add('y').
# Inferred: any other string that exactly matches a known id/class
#           (e.g. el('p', 'qr-message')) — matched later in atlas_graph.
# =============================================================================
JS_ID_CALL = re.compile(r"(?:getElementById|byId)\(\s*['\"]([\w:-]+)['\"]")
JS_SELECTOR_CALL = re.compile(r"(?:querySelector(?:All)?|closest|matches)\(\s*(['\"`])(.+?)\1")
JS_CLASSLIST = re.compile(r"classList\.(?:add|remove|toggle|contains|replace)\(([^)]*)\)")
# el.id = 'x' or setAttribute('id', 'x'); not el.dataset.id (a data-id attribute, not an element id)
JS_ID_SET = re.compile(r"(?:(?<!dataset)\.id\s*=\s*|setAttribute\(\s*['\"]id['\"]\s*,\s*)['\"]([\w:-]+)['\"]")


def js_dom_usage(strings: list[tuple[str, int]], text: str, facts: FileFacts) -> None:
    """Certain id/class uses from DOM calls, plus every string token for inferred matching."""
    for match in JS_ID_CALL.finditer(text):
        facts.ids_used.append((match.group(1), line_of(text, match.start()), True))
    for match in JS_ID_SET.finditer(text):  # ids created by script count as declared
        facts.ids_declared.append((match.group(1), line_of(text, match.start())))
    for match in JS_SELECTOR_CALL.finditer(text):
        line = line_of(text, match.start())
        selector = re.sub(r"\[[^\]]*\]", " ", match.group(2))
        facts.ids_used += [(name, line, True) for name in CSS_ID.findall(selector)]
        facts.classes_used += [(name, line, True) for name in CSS_CLASS.findall(selector)]
    for match in JS_CLASSLIST.finditer(text):
        line = line_of(text, match.start())
        for literal in re.findall(r"['\"]([\w-]+)['\"]", match.group(1)):
            facts.classes_used.append((literal, line, True))
    for content, _offset in strings:
        facts.strings.update(re.findall(r"[A-Za-z_][\w-]*", content))
