"""
Atlas — atlas_graph.py: link the facts of every file into one graph,
then answer questions about it and check its health.

Node ids:   file:assets/js/app.js     fn:assets/js/app.js::renderCode
            class:app.py::DistillHandler   id:#textInput   css:.qr-frame
Edge kinds: calls, uses, imports, loads, declares, styles
Certainty:  "certain"  — written explicitly in the code (a call, an import, getElementById)
            "inferred" — matched by name (a JS function defined in another file,
                         or a string that happens to equal a CSS class name)

TABLE OF CONTENTS
  01  Graph data structure
  02  Building the graph (and combining several projects)
  03  Linking names (functions, modules)
  04  Linking ids & CSS classes
  05  Finding nodes by name
  06  Questions: uses, depends on, path, hubs
  07  Health checks
  08  Communities (subsystems)
"""

from __future__ import annotations

from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field, replace
from pathlib import Path

import atlas_scan as scan

CERTAIN, INFERRED = "certain", "inferred"
# Python methods called by frameworks (http.server, unittest, html.parser…), never by our own code.
FRAMEWORK_HOOKS = ("do_", "handle_", "test", "setUp", "tearDown", "visit_", "__")
FRAMEWORK_NAMES = {"main", "log_message", "setUpClass", "tearDownClass"}
MAX_METHOD_MATCHES = 3  # obj.name() linking to more methods than this is noise (think .get, .run)
MIN_COMMUNITY = 3  # smaller groups (often lone CSS classes) aren't reported as communities
MAX_PASSES = 20  # Louvain: moving rounds per level (it settles long before this)


# =============================================================================
# 01  GRAPH DATA STRUCTURE
# =============================================================================
@dataclass
class Node:
    """One thing in the project: a folder, file, function, class, HTML id or CSS class."""

    id: str
    type: str  # folder | file | function | class | html-id | css-class
    name: str
    file: str = ""
    line: int = 0
    lang: str = ""


@dataclass
class Edge:
    """A relationship. `count` = how many times it occurs; `line` = the first place."""

    source: str
    target: str
    kind: str
    certainty: str
    line: int = 0
    count: int = 1


@dataclass
class Graph:
    """Nodes by id, edges by (source, target, kind), plus scan errors."""

    root: str
    nodes: dict[str, Node] = field(default_factory=dict)
    edges: dict[tuple[str, str, str], Edge] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    libraries: set[str] = field(default_factory=set)  # external libraries the pages load (their classes aren't ours)
    projects: list[str] = field(default_factory=list)  # the projects in a combined map (empty for one project)
    satellite: str = ""  # a project drawn as Claude's core inside the globe (e.g. .claude), or ""
    touches: dict[str, dict[str, int]] = field(default_factory=dict)  # file id → {"edits", "writes"} by Claude

    def add_node(self, node: Node) -> Node:
        """Add a node (the first definition wins if an id repeats)."""
        return self.nodes.setdefault(node.id, node)

    def add_edge(self, source: str, target: str, kind: str, certainty: str, line: int = 0) -> None:
        """Add an edge, or count a repeat. A certain sighting upgrades an inferred one."""
        if source == target:
            return
        key = (source, target, kind)
        if key in self.edges:
            edge = self.edges[key]
            edge.count += 1
            if certainty == CERTAIN:
                edge.certainty = CERTAIN
            return
        self.edges[key] = Edge(source, target, kind, certainty, line)

    def incoming(self, node_id: str) -> list[Edge]:
        """Edges pointing at a node, sorted by kind then source."""
        return sorted((e for e in self.edges.values() if e.target == node_id), key=lambda e: (e.kind, e.source))

    def outgoing(self, node_id: str) -> list[Edge]:
        """Edges leaving a node, sorted by kind then target."""
        return sorted((e for e in self.edges.values() if e.source == node_id), key=lambda e: (e.kind, e.target))


# =============================================================================
# 02  BUILDING THE GRAPH
# =============================================================================
def build_graph(root: Path, skip: tuple[str, ...] = ()) -> Graph:
    """Scan every source file under root and link everything together (leaving out names matching `skip`)."""
    root = root.resolve()
    all_facts = [scan.scan_file(path, root) for path in scan.find_source_files(root, skip)]
    graph = Graph(root=str(root))
    for facts in all_facts:
        add_file_and_definitions(graph, facts)
        graph.libraries |= facts.libraries
    link_names(graph, all_facts)
    link_dom(graph, all_facts)
    add_folders_and_files(graph, root, skip)
    return graph


def add_folders_and_files(graph: Graph, root: Path, skip: tuple[str, ...] = ()) -> None:
    """One node per folder, plus every other file (images, docs, data: anything that isn't scanned code),
    each linked from the folder it sits in ("contains"). The project's own folder is "." (named after it)."""
    folders, files = scan.find_all_files(root, skip)
    for folder in folders:
        rel = folder.relative_to(root).as_posix()
        graph.add_node(Node(folder_id(rel), "folder", rel if rel != "." else root.name, rel, 0, ""))
        if rel != ".":
            graph.add_edge(folder_id(Path(rel).parent.as_posix()), folder_id(rel), "contains", CERTAIN)
    for path in files:
        rel = path.relative_to(root).as_posix()
        file_id = f"file:{rel}"
        graph.add_node(Node(file_id, "file", rel, rel, 0, path.suffix.lstrip(".").lower() or "file"))
        graph.add_edge(folder_id(Path(rel).parent.as_posix()), file_id, "contains", CERTAIN)


def folder_id(rel: str) -> str:
    """'folder:assets/js', or 'folder:.' for the project's own folder."""
    return f"folder:{rel or '.'}"


def add_file_and_definitions(graph: Graph, facts: scan.FileFacts) -> None:
    """The file node, one node per function/class, and file → definition edges."""
    file_id = f"file:{facts.path}"
    graph.add_node(Node(file_id, "file", facts.path, facts.path, 0, facts.lang))
    if facts.error:
        graph.errors.append(f"{facts.path}: {facts.error}")
    for definition in facts.definitions:
        prefix = "class" if definition.kind == "class" else "fn"
        node = Node(f"{prefix}:{facts.path}::{definition.qualname}", definition.kind, definition.qualname)
        node.file, node.line, node.lang = facts.path, definition.line, facts.lang
        graph.add_node(node)
        graph.add_edge(file_id, node.id, "declares", CERTAIN, definition.line)


def merge_graphs(graphs: list[Graph], name: str) -> Graph:
    """One graph of several projects. Every id and path starts with its project's folder name
    (file:my_site/app.js, id:my_site/#x), so projects never link to each other by accident."""
    merged = Graph(root=name)
    for graph in graphs:
        project = Path(graph.root).name
        merged.projects.append(project)
        for node in graph.nodes.values():
            merged.add_node(prefixed_node(node, project))
        for edge in graph.edges.values():
            moved = replace(edge, source=prefixed_id(edge.source, project), target=prefixed_id(edge.target, project))
            merged.edges[(moved.source, moved.target, moved.kind)] = moved
        merged.errors += [f"{project}/{error}" for error in graph.errors]
        merged.libraries |= graph.libraries
    return merged


def prefixed_id(node_id: str, project: str) -> str:
    """'fn:app.js::init' → 'fn:my_site/app.js::init' (the type prefix stays first)."""
    kind, _, rest = node_id.partition(":")
    return f"{kind}:{project}/{rest}"


def prefixed_node(node: Node, project: str) -> Node:
    """A copy of a node inside a combined map: its id, file (and a file's name) start with the project."""
    in_project = f"{project}/{node.file}" if node.file else ""
    name = {"file": in_project, "folder": in_project.removesuffix("/.")}.get(node.type, node.name)
    return replace(node, id=prefixed_id(node.id, project), file=in_project, name=name)


# =============================================================================
# 03  LINKING NAMES (functions, modules)
# =============================================================================
def link_names(graph: Graph, all_facts: list[scan.FileFacts]) -> None:
    """Imports, HTML → script/stylesheet loads, and every resolvable function reference."""
    modules = python_module_files(all_facts)
    by_name = {"javascript": js_function_index(graph), "methods": python_method_index(graph)}
    for facts in all_facts:
        file_id = f"file:{facts.path}"
        for module, line in facts.imports:
            if module in modules:
                graph.add_edge(file_id, f"file:{modules[module]}", "imports", CERTAIN, line)
        for target, line in facts.loads:
            graph.add_edge(file_id, f"file:{target}", "loads", CERTAIN, line)
        for ref in facts.references:
            source = scope_node_id(graph, facts.path, ref.scope)
            for target, certainty in resolve_reference(graph, facts, ref, modules, by_name):
                graph.add_edge(source, target, "calls" if ref.is_call else "uses", certainty, ref.line)


def python_module_files(all_facts: list[scan.FileFacts]) -> dict[str, str]:
    """{"summarize": "summarize.py", "pkg.mod": "pkg/mod.py", "pkg": "pkg/__init__.py"} for every Python file."""
    modules = {}
    for facts in all_facts:
        if facts.lang == "python":
            dotted = facts.path[: -len(".py")].replace("/", ".")
            modules[dotted] = facts.path
            if dotted.endswith(".__init__"):  # pkg/__init__.py is the module "pkg"
                modules[dotted[: -len(".__init__")]] = facts.path
            modules.setdefault(dotted.rsplit(".", 1)[-1], facts.path)
    return modules


def js_function_index(graph: Graph) -> dict[str, list[str]]:
    """{function name: [node ids]} across all JavaScript files (for cross-file links)."""
    index: dict[str, list[str]] = {}
    for node in graph.nodes.values():
        if node.type == "function" and node.lang == "javascript":
            index.setdefault(node.name, []).append(node.id)
    return index


def python_method_index(graph: Graph) -> dict[str, list[str]]:
    """{method name: [node ids]} for Python methods ("Greeter.greet" is filed under "greet")."""
    index: dict[str, list[str]] = {}
    for node in graph.nodes.values():
        if node.type == "function" and node.lang == "python" and "." in node.name:
            index.setdefault(node.name.rsplit(".", 1)[1], []).append(node.id)
    return index


def resolve_reference(graph, facts, ref, modules, by_name) -> list[tuple[str, str]]:
    """[(target node id, certainty)] for a referenced name; empty when it isn't one of ours."""
    if ref.method:  # obj.greet(): every method with that name, unless the name is too common to mean much
        candidates = by_name["methods"].get(ref.name, [])
        return [(c, INFERRED) for c in candidates] if len(candidates) <= MAX_METHOD_MATCHES else []
    if ref.module:  # Python: core.summarize, `from summarize import x`, or ImportedClass.method
        target = module_member(graph, modules, ref.module, ref.name)
        return [(target, CERTAIN)] if target else []
    for prefix in ("fn", "class"):
        local = f"{prefix}:{facts.path}::{ref.name}"
        if local in graph.nodes:
            return [(local, CERTAIN)]
    candidates = by_name["javascript"].get(ref.name, []) if facts.lang == "javascript" else []
    return [(candidates[0], INFERRED)] if len(candidates) == 1 else []


def module_member(graph: Graph, modules: dict[str, str], module: str, name: str) -> str:
    """Node id of `name` in a Python module ("pkg.helpers", "tidy"), or of a method on an imported class."""
    head, _, tail = module.rpartition(".")
    options = [(modules.get(module), name)]
    if head:  # module "pkg.main.Greeter" + name "greet" → pkg/main.py :: Greeter.greet
        options.append((modules.get(head), f"{tail}.{name}"))
    for path, qualname in options:
        for prefix in ("fn", "class"):
            if path and f"{prefix}:{path}::{qualname}" in graph.nodes:
                return f"{prefix}:{path}::{qualname}"
    return ""


def scope_node_id(graph: Graph, path: str, scope: str) -> str:
    """The function/method node a reference sits in, or the file for top-level code."""
    node_id = f"fn:{path}::{scope}"
    return node_id if scope and node_id in graph.nodes else f"file:{path}"


# =============================================================================
# 04  LINKING IDS & CSS CLASSES
# =============================================================================
def link_dom(graph: Graph, all_facts: list[scan.FileFacts]) -> None:
    """HTML ids and CSS classes: who declares them, who styles them, who uses them."""
    for facts in all_facts:
        file_id = f"file:{facts.path}"
        for name, line in facts.ids_declared:
            graph.add_edge(file_id, dom_node(graph, "html-id", name, facts, line), "declares", CERTAIN, line)
        for name, line in facts.classes_declared:
            graph.add_edge(file_id, dom_node(graph, "css-class", name, facts, line), "styles", CERTAIN, line)
        kind = "styles" if facts.lang == "css" else "uses"
        for name, line, certain in facts.ids_used:
            target = dom_node(graph, "html-id", name, facts, line)
            graph.add_edge(file_id, target, kind, CERTAIN if certain else INFERRED, line)
        for name, line, certain in facts.classes_used:
            target = dom_node(graph, "css-class", name, facts, line)
            graph.add_edge(file_id, target, "uses", CERTAIN if certain else INFERRED, line)
    link_js_strings(graph, all_facts)


def dom_node(graph: Graph, node_type: str, name: str, facts: scan.FileFacts, line: int) -> str:
    """Id of the shared node for an HTML id (#x) or CSS class (.x); created on first sight."""
    node_id = f"id:#{name}" if node_type == "html-id" else f"css:.{name}"
    label = f"#{name}" if node_type == "html-id" else f".{name}"
    graph.add_node(Node(node_id, node_type, label, facts.path, line, facts.lang))
    return node_id


def link_js_strings(graph: Graph, all_facts: list[scan.FileFacts]) -> None:
    """A JS string equal to a known id or class name probably refers to it (inferred).
    A string ending in "-" (as in `resume--${template}`) may build any class starting with it.
    Only fills gaps: a link already found (e.g. querySelector('#x')) isn't counted again."""
    classes = [n for n in graph.nodes.values() if n.type == "css-class"]
    for facts in all_facts:
        source = f"file:{facts.path}"
        for token in facts.strings:
            targets = [node_id for node_id in (f"id:#{token}", f"css:.{token}") if node_id in graph.nodes]
            if token.endswith(("-", "_")) and len(token) > 2:
                targets += [node.id for node in classes if node.name[1:].startswith(token)]
            for node_id in targets:
                if (source, node_id, "uses") not in graph.edges:
                    graph.add_edge(source, node_id, "uses", INFERRED)


# =============================================================================
# 05  FINDING NODES BY NAME
# =============================================================================
def find_nodes(graph: Graph, query: str) -> list[Node]:
    """Nodes matching a query: exact id, then exact name, then file path ending, then name suffix."""
    if query in graph.nodes:
        return [graph.nodes[query]]
    tests = (
        lambda n: n.name == query,
        lambda n: n.type == "file" and (n.name.endswith("/" + query) or n.name == query),
        lambda n: n.name.endswith("." + query),  # a method by its short name: "send_event"
    )
    for test in tests:
        matches = sorted((n for n in graph.nodes.values() if test(n)), key=lambda n: n.id)
        if matches:
            return matches
    return []


# =============================================================================
# 06  QUESTIONS: USES, DEPENDS ON, PATH, HUBS
# =============================================================================
def shortest_path(graph: Graph, start: str, goal: str) -> list[Edge]:
    """The fewest-steps chain of edges linking two nodes (in either direction), or []. Folder links are
    skipped: two files sharing a folder doesn't connect their code."""
    neighbours: dict[str, list[tuple[str, Edge]]] = {}
    for edge in graph.edges.values():
        if edge.kind == "contains":
            continue
        neighbours.setdefault(edge.source, []).append((edge.target, edge))
        neighbours.setdefault(edge.target, []).append((edge.source, edge))
    previous: dict[str, tuple[str, Edge] | None] = {start: None}
    queue = deque([start])
    while queue:
        current = queue.popleft()
        if current == goal:
            return trace_back(previous, goal)
        for nxt, edge in neighbours.get(current, []):
            if nxt not in previous:
                previous[nxt] = (current, edge)
                queue.append(nxt)
    return []


def trace_back(previous: dict, goal: str) -> list[Edge]:
    """Walk the breadth-first-search parents back from goal to start."""
    edges, node = [], goal
    while previous[node] is not None:
        node, edge = previous[node]
        edges.append(edge)
    return list(reversed(edges))


def hubs(graph: Graph, limit: int = 10, types: tuple[str, ...] = ("function", "class")) -> list[tuple[Node, int]]:
    """The most-connected functions/classes ("god nodes"): changing them affects the most."""
    degree = Counter()
    for edge in graph.edges.values():
        if edge.kind in ("calls", "uses"):
            degree[edge.source] += 1
            degree[edge.target] += 1
    ranked = [(graph.nodes[i], d) for i, d in degree.most_common() if i in graph.nodes]
    return [(n, d) for n, d in ranked if n.type in types][:limit]


# =============================================================================
# 07  HEALTH CHECKS
# These are "possible" problems: dynamic code (names built at runtime)
# can use things Atlas can't see, so always check before deleting.
# =============================================================================
def health(graph: Graph) -> dict[str, list[Node]]:
    """{check name: [nodes]} — unused functions, unused CSS classes, missing ids."""
    used_by = Counter(e.target for e in graph.edges.values() if e.kind in ("calls", "uses"))
    declared = {e.target for e in graph.edges.values() if e.kind == "declares" and e.target.startswith("id:")}
    return {
        "unused_functions": [
            n for n in graph.nodes.values()
            if n.type in ("function", "class") and not used_by[n.id] and not is_entry_point(n)
        ],
        "unused_css_classes": [
            n for n in graph.nodes.values()
            if n.type == "css-class" and not used_by[n.id] and not from_library(graph, n)
        ],
        "missing_ids": [
            n for n in graph.nodes.values()
            if n.type == "html-id" and n.id not in declared and used_by[n.id]
        ],
    }  # fmt: skip


def from_library(graph: Graph, node: Node) -> bool:
    """A class like ".leaflet-tile-pane" when the page loads leaflet.css/js: the library creates it, not our code.
    Dashes in the file name may be dropped in its classes: maplibre-gl.css → ".maplibregl-map"."""
    prefixes = {f"{name}-" for library in graph.libraries for name in (library, library.replace("-", ""))}
    return node.name[1:].startswith(tuple(prefixes))


def is_entry_point(node: Node) -> bool:
    """Functions called from outside the code: framework hooks, test files, dunders, main."""
    short = node.name.rsplit(".", 1)[-1]
    in_test_file = Path(node.file).name.startswith("test_") or Path(node.file).stem.endswith("_test")
    return short in FRAMEWORK_NAMES or short.startswith(FRAMEWORK_HOOKS) or (in_test_file and node.lang == "python")


# =============================================================================
# 08  COMMUNITIES (subsystems)
# Groups of nodes linked more to each other than to the rest, found with the
# Louvain method (modularity), in a fixed order so the same code always gives
# the same groups. Each connected part is grouped on its own: modularity
# blurs small groups in a big graph, and unconnected parts (like the
# projects in a combined map) have nothing to do with each other.
# =============================================================================
@dataclass
class Community:
    """A subsystem: its number (0 = biggest), a name from its hubs, members and main file."""

    id: int
    name: str
    members: list[str]
    hub: str
    file: str


def communities(graph: Graph) -> list[Community]:
    """The graph's communities of MIN_COMMUNITY+ nodes, biggest first."""
    groups: dict[str, list[str]] = defaultdict(list)
    adjacency = undirected(graph)
    for part in connected_parts(adjacency):
        for node_id, group in louvain({node: adjacency[node] for node in part}).items():
            groups[group].append(node_id)
    ranked = sorted((g for g in groups.values() if len(g) >= MIN_COMMUNITY), key=lambda g: (-len(g), min(g)))
    return [describe_community(graph, i, sorted(members)) for i, members in enumerate(ranked)]


def undirected(graph: Graph) -> dict[str, dict[str, float]]:
    """{node: {neighbour: weight}} with every link counted once each way (all nodes, even unlinked)."""
    adjacency: dict[str, dict[str, float]] = {node_id: {} for node_id in sorted(graph.nodes)}
    for edge in graph.edges.values():
        if edge.kind == "contains":
            continue  # the folder tree says where code sits, not how it works together
        if edge.source in adjacency and edge.target in adjacency:
            adjacency[edge.source][edge.target] = adjacency[edge.source].get(edge.target, 0) + 1
            adjacency[edge.target][edge.source] = adjacency[edge.target].get(edge.source, 0) + 1
    return adjacency


def connected_parts(adjacency: dict[str, dict[str, float]]) -> list[list[str]]:
    """The graph's connected parts (each sorted), in a fixed order."""
    seen: set[str] = set()
    parts = []
    for start in adjacency:
        if start in seen:
            continue
        seen.add(start)
        part, queue = [], deque([start])
        while queue:
            node = queue.popleft()
            part.append(node)
            fresh = [n for n in adjacency[node] if n not in seen]
            seen.update(fresh)
            queue.extend(fresh)
        parts.append(sorted(part))
    return parts


def louvain(adjacency: dict[str, dict[str, float]]) -> dict[str, str]:
    """{node: community}: move nodes between groups, merge groups into nodes, repeat until stable."""
    membership = {node: node for node in adjacency}
    while True:
        moved = louvain_level(adjacency)
        membership = {node: moved[group] for node, group in membership.items()}
        if len(set(moved.values())) == len(adjacency):
            return membership
        adjacency = aggregate(adjacency, moved)


def louvain_level(adjacency: dict[str, dict[str, float]]) -> dict[str, str]:
    """One level: each node joins the neighbouring group that raises modularity most, until none moves."""
    degree = {node: sum(links.values()) for node, links in adjacency.items()}
    total = sum(degree.values()) or 1
    group = {node: node for node in adjacency}
    group_degree = dict(degree)
    for _ in range(MAX_PASSES):
        moves = sum(move_node(node, adjacency, degree, total, group, group_degree) for node in adjacency)
        if not moves:
            break
    return group


def move_node(node, adjacency, degree, total, group, group_degree) -> int:
    """Put one node in its best group; 1 if it moved, else 0."""
    weight_to: dict[str, float] = defaultdict(float)
    for neighbour, weight in adjacency[node].items():
        if neighbour != node:
            weight_to[group[neighbour]] += weight
    current = group[node]
    group_degree[current] -= degree[node]
    best, best_gain = current, weight_to.get(current, 0) - group_degree[current] * degree[node] / total
    for candidate in sorted(weight_to):
        gain = weight_to[candidate] - group_degree[candidate] * degree[node] / total
        if gain > best_gain + 1e-12:
            best, best_gain = candidate, gain
    group_degree[best] += degree[node]
    group[node] = best
    return int(best != current)


def aggregate(adjacency: dict[str, dict[str, float]], group: dict[str, str]) -> dict[str, dict[str, float]]:
    """A smaller graph with one node per group (links inside a group become a self-link)."""
    merged: dict[str, dict[str, float]] = {g: {} for g in sorted(set(group.values()))}
    for node, links in adjacency.items():
        for neighbour, weight in links.items():
            a, b = group[node], group[neighbour]
            merged[a][b] = merged[a].get(b, 0) + weight
    return merged


def describe_community(graph: Graph, number: int, members: list[str]) -> Community:
    """Name a community "app.js — el · campDetail": its main file, then its two most-linked
    functions/classes (or, for a group of ids and CSS classes, its most-linked members)."""
    links = Counter()
    for edge in graph.edges.values():
        links[edge.source] += 1
        links[edge.target] += 1
    code = [m for m in members if graph.nodes[m].type in ("function", "class")]
    named = code or [m for m in members if graph.nodes[m].type != "file"] or members
    ranked = sorted(named, key=lambda m: (-links[m], m))
    files = Counter(graph.nodes[m].file for m in members if graph.nodes[m].file)
    main_file = min(files, key=lambda f: (-files[f], f)) if files else ""
    top = " · ".join(graph.nodes[m].name for m in ranked[:2])
    parts = main_file.split("/")
    short = f"{parts[0]}/{parts[-1]}" if graph.projects and len(parts) > 1 else parts[-1]  # combined: say which project
    name = f"{short} — {top}" if main_file else top
    return Community(number, name, members, ranked[0], main_file)
