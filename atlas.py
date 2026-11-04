#!/usr/bin/env python3
"""
Atlas — a map of your code. Command-line tool.

Scans a project (Python, JavaScript, HTML, CSS) and shows how its files,
functions, HTML ids and CSS classes connect. Standard library only.

    python3 atlas.py build  PROJECT          # map + report + interactive page
    python3 atlas.py uses   PROJECT NAME     # what uses NAME?
    python3 atlas.py deps   PROJECT NAME     # what does NAME use?
    python3 atlas.py path   PROJECT A B      # how are A and B connected?
    python3 atlas.py explain PROJECT NAME    # everything about NAME
    python3 atlas.py hubs   PROJECT          # most-connected functions
    python3 atlas.py check  PROJECT          # health checks (unused code, missing ids)

NAME can be a function (renderCode), a method (DistillHandler.send_event),
a file (app.js), an id (#textInput) or a CSS class (.qr-frame).
Results go to the Atlas folder (maps/PROJECT/), never into your project.

TABLE OF CONTENTS
  01  Settings & errors
  02  Command-line options
  03  Printing nodes and edges
  04  Commands
  05  Main
"""

from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

import atlas_export
import atlas_graph as ag

# =============================================================================
# 01  SETTINGS & ERRORS
# =============================================================================
MAPS_DIR = Path(__file__).resolve().parent / "maps"
EXIT_OK, EXIT_ERROR, EXIT_USAGE, EXIT_ISSUES = 0, 1, 2, 3


class AtlasError(Exception):
    """A problem with a message that is safe and helpful to show."""


# =============================================================================
# 02  COMMAND-LINE OPTIONS
# =============================================================================
def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Sub-commands and their arguments (see --help)."""
    parser = argparse.ArgumentParser(prog="atlas.py", description="Atlas: a map of your code.")
    sub = parser.add_subparsers(dest="command", required=True, metavar="command")
    build = sub.add_parser("build", help="write graph.json, GRAPH_REPORT.md and graph.html")
    build.add_argument("project")
    build.add_argument("--out", help="output folder (default: maps/PROJECT-NAME in the Atlas folder)")
    build.add_argument("--open", action="store_true", help="open graph.html in the browser")
    for name, text in (("uses", "what uses NAME?"), ("deps", "what does NAME use?"), ("explain", "all about NAME")):
        cmd = sub.add_parser(name, help=text)
        cmd.add_argument("project")
        cmd.add_argument("name")
    path = sub.add_parser("path", help="shortest chain of links between A and B")
    path.add_argument("project")
    path.add_argument("a")
    path.add_argument("b")
    hubs = sub.add_parser("hubs", help="most-connected functions and classes")
    hubs.add_argument("project")
    hubs.add_argument("-n", type=int, default=10, help="how many to show (default 10)")
    check = sub.add_parser("check", help="health checks; exit code 3 when something is found")
    check.add_argument("project")
    return parser.parse_args(argv)


# =============================================================================
# 03  PRINTING NODES AND EDGES
# =============================================================================
def where(node: ag.Node) -> str:
    """Where a node is: "assets/js/app.js:612", or just the path for files."""
    return f"{node.file}:{node.line}" if node.line else node.file


def describe(graph: ag.Graph, node_id: str) -> str:
    """One line about a node, e.g. 'function  renderCode  (assets/js/app.js:612)'."""
    node = graph.nodes.get(node_id)
    if not node:
        return node_id
    return f"{node.type:9} {node.name}  ({where(node)})" if node.type != "file" else f"file      {node.name}"


def print_edges(graph: ag.Graph, edges: list[ag.Edge], outgoing: bool) -> None:
    """One line per edge: kind, the node at the other end, certainty and count."""
    if not edges:
        print("  (nothing)")
    for edge in edges:
        other = edge.target if outgoing else edge.source
        extra = " · inferred" if edge.certainty == ag.INFERRED else ""
        times = f" ×{edge.count}" if edge.count > 1 else ""
        print(f"  {edge.kind:8} {describe(graph, other)}{times}{extra}")


def resolve_one(graph: ag.Graph, query: str) -> ag.Node:
    """Exactly one node for a name; otherwise a helpful error (unknown, or which one did you mean?)."""
    found = ag.find_nodes(graph, query)
    if not found:
        raise AtlasError(f'Nothing called "{query}" in this project. Try a file name, function, #id or .class.')
    if len(found) > 1:
        options = "\n".join(f"  {n.id}" for n in found[:15])
        raise AtlasError(f'"{query}" matches {len(found)} things. Use one of these exact ids:\n{options}')
    return found[0]


# =============================================================================
# 04  COMMANDS
# =============================================================================
def load_project(project: str) -> ag.Graph:
    """Build the graph for a project folder (fast: tens of milliseconds for these projects)."""
    root = Path(project).expanduser()
    if not root.is_dir():
        raise AtlasError(f"Not a folder: {project}")
    graph = ag.build_graph(root)
    if len(graph.nodes) == 0:
        raise AtlasError(f"No Python, JavaScript, HTML or CSS files found in {project}")
    return graph


def cmd_build(args: argparse.Namespace) -> int:
    """Write the three outputs and print where they are."""
    graph = load_project(args.project)
    out = Path(args.out).expanduser() if args.out else MAPS_DIR / Path(graph.root).name
    paths = atlas_export.write_outputs(graph, out)
    counts = atlas_export.graph_to_dict(graph)["meta"]["counts"]
    summary = ", ".join(f"{v} {atlas_export.TYPE_LABELS[k].lower()}" for k, v in counts.items())
    print(f"Mapped {Path(graph.root).name}: {summary}, {len(graph.edges)} links.")
    for path in paths.values():
        print(f"  {path}")
    if args.open:
        webbrowser.open(paths["html"].as_uri())
    return EXIT_OK


def cmd_links(args: argparse.Namespace) -> int:
    """uses / deps: incoming or outgoing links of one node."""
    graph = load_project(args.project)
    node = resolve_one(graph, args.name)
    outgoing = args.command == "deps"
    title = "uses" if outgoing else "is used by"
    print(f"{describe(graph, node.id)}\n{title}:")
    edges = graph.outgoing(node.id) if outgoing else graph.incoming(node.id)
    print_edges(graph, edges, outgoing)
    return EXIT_OK


def cmd_explain(args: argparse.Namespace) -> int:
    """Everything about one node: where it is, what uses it, what it uses."""
    graph = load_project(args.project)
    node = resolve_one(graph, args.name)
    print(describe(graph, node.id))
    print(f"id: {node.id}\n\nused by:")
    print_edges(graph, graph.incoming(node.id), outgoing=False)
    print("\nuses:")
    print_edges(graph, graph.outgoing(node.id), outgoing=True)
    return EXIT_OK


def cmd_path(args: argparse.Namespace) -> int:
    """The shortest chain of links between two nodes."""
    graph = load_project(args.project)
    start, goal = resolve_one(graph, args.a), resolve_one(graph, args.b)
    edges = ag.shortest_path(graph, start.id, goal.id)
    if not edges:
        print(f"No connection between {start.name} and {goal.name}.")
        return EXIT_OK
    print(f"{len(edges)} step(s) from {start.name} to {goal.name}:")
    for edge in edges:
        print(f"  {describe(graph, edge.source)}  --{edge.kind}-->  {describe(graph, edge.target)}")
    return EXIT_OK


def cmd_hubs(args: argparse.Namespace) -> int:
    """The most-connected functions and classes."""
    graph = load_project(args.project)
    for node, degree in ag.hubs(graph, max(1, args.n)):
        print(f"  {degree:4} links  {node.name}  ({where(node)})")
    return EXIT_OK


def cmd_check(args: argparse.Namespace) -> int:
    """Health checks; exit code 3 if anything was found (useful before committing)."""
    graph = load_project(args.project)
    results = ag.health(graph)
    for name, found in results.items():
        print(f"{name.replace('_', ' ')}: {len(found) or 'none ✓'}")
        for node in sorted(found, key=lambda n: (n.file, n.line)):
            print(f"  {node.name}  ({where(node)})")
    for error in graph.errors:
        print(f"couldn't read: {error}")
    return EXIT_ISSUES if any(results.values()) else EXIT_OK


# =============================================================================
# 05  MAIN
# =============================================================================
COMMANDS = {
    "build": cmd_build, "uses": cmd_links, "deps": cmd_links, "explain": cmd_explain,
    "path": cmd_path, "hubs": cmd_hubs, "check": cmd_check,
}  # fmt: skip


def main(argv: list[str] | None = None) -> int:
    """Run one command; turn known problems into a clear message and exit code."""
    args = parse_args(argv)
    try:
        return COMMANDS[args.command](args)
    except AtlasError as error:
        print(f"Error: {error}", file=sys.stderr)
        return EXIT_ERROR
    except OSError as error:
        print(f"Error: {error.strerror}: {error.filename}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
