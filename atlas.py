#!/usr/bin/env python3
"""
Atlas — a map of your code. Command-line tool.

Scans a project (Python, JavaScript, HTML, CSS) and shows how its files,
functions, HTML ids and CSS classes connect. Standard library only.

    python3 atlas.py build  PROJECT          # map + report + interactive page
    python3 atlas.py build  P1 P2 … --name N # one combined map of several projects
    python3 atlas.py uses   PROJECT NAME     # what uses NAME?
    python3 atlas.py deps   PROJECT NAME     # what does NAME use?
    python3 atlas.py path   PROJECT A B      # how are A and B connected?
    python3 atlas.py explain PROJECT NAME    # everything about NAME
    python3 atlas.py hubs   PROJECT          # most-connected functions
    python3 atlas.py communities PROJECT     # subsystems: groups of code linked mostly to each other
    python3 atlas.py check  PROJECT          # health checks (unused code, missing ids)

NAME can be a function (renderCode), a method (DistillHandler.send_event),
a file (app.js), an id (#textInput) or a CSS class (.qr-frame).
Results go to the Atlas folder (maps/PROJECT/), never into your project.

TABLE OF CONTENTS
  01  Settings & errors
  02  Command-line options
  03  Describing nodes and edges
  04  Answers (text lines, shared with atlas_mcp.py)
  05  Commands
  06  Main
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
    build.add_argument("project", nargs="+", help="one project folder, or several for a combined map")
    build.add_argument("--name", default="combined", help='name of a combined map (default "combined")')
    build.add_argument("--out", help="output folder (default: maps/NAME in the Atlas folder)")
    build.add_argument("--open", action="store_true", help="open graph.html in the browser")
    add_query_commands(sub)
    check = sub.add_parser("check", help="health checks; exit code 3 when something is found")
    check.add_argument("project")
    return parser.parse_args(argv)


def add_query_commands(sub) -> None:
    """uses, deps, explain, path, hubs and communities: the questions about one project."""
    for name, text in (("uses", "what uses NAME?"), ("deps", "what does NAME use?"), ("explain", "all about NAME")):
        cmd = sub.add_parser(name, help=text)
        cmd.add_argument("project")
        cmd.add_argument("name")
    path = sub.add_parser("path", help="shortest chain of links between A and B")
    path.add_argument("project")
    path.add_argument("a")
    path.add_argument("b")
    for name, text, default in (
        ("hubs", "most-connected functions and classes", 10),
        ("communities", "subsystems: groups of code linked mostly to each other", 15),
    ):
        cmd = sub.add_parser(name, help=text)
        cmd.add_argument("project")
        cmd.add_argument("-n", type=int, default=default, help=f"how many to show (default {default})")


# =============================================================================
# 03  DESCRIBING NODES AND EDGES (as text lines, for the terminal and atlas_mcp.py)
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


def edge_lines(graph: ag.Graph, edges: list[ag.Edge], outgoing: bool) -> list[str]:
    """One line per edge: kind, the node at the other end, certainty and count."""
    if not edges:
        return ["  (nothing)"]
    lines = []
    for edge in edges:
        other = edge.target if outgoing else edge.source
        extra = " · inferred" if edge.certainty == ag.INFERRED else ""
        times = f" ×{edge.count}" if edge.count > 1 else ""
        lines.append(f"  {edge.kind:8} {describe(graph, other)}{times}{extra}")
    return lines


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
# 04  ANSWERS — each returns text lines (the terminal prints them; the MCP server sends them)
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


def load_projects(projects: list[str], name: str) -> ag.Graph:
    """One project's graph, or several combined into one (each keeps its own folder name)."""
    if len(projects) == 1:
        return load_project(projects[0])
    graphs = [load_project(project) for project in projects]
    names = [Path(graph.root).name for graph in graphs]
    repeated = sorted({n for n in names if names.count(n) > 1})
    if repeated:
        raise AtlasError(f"Two projects share a folder name ({', '.join(repeated)}); rename one first.")
    return ag.merge_graphs(graphs, name)


def links_lines(graph: ag.Graph, name: str, outgoing: bool) -> list[str]:
    """uses / deps: incoming or outgoing links of one node."""
    node = resolve_one(graph, name)
    edges = graph.outgoing(node.id) if outgoing else graph.incoming(node.id)
    title = "uses" if outgoing else "is used by"
    return [describe(graph, node.id), f"{title}:", *edge_lines(graph, edges, outgoing)]


def explain_lines(graph: ag.Graph, name: str) -> list[str]:
    """Everything about one node: where it is, its community, what uses it, what it uses."""
    node = resolve_one(graph, name)
    group = next((c for c in ag.communities(graph) if node.id in c.members), None)
    lines = [describe(graph, node.id), f"id: {node.id}"]
    if group:
        lines.append(f"community: {group.name} ({len(group.members)} members)")
    lines += ["", "used by:", *edge_lines(graph, graph.incoming(node.id), outgoing=False)]
    return lines + ["", "uses:", *edge_lines(graph, graph.outgoing(node.id), outgoing=True)]


def path_lines(graph: ag.Graph, a: str, b: str) -> list[str]:
    """The shortest chain of links between two nodes."""
    start, goal = resolve_one(graph, a), resolve_one(graph, b)
    edges = ag.shortest_path(graph, start.id, goal.id)
    if not edges:
        return [f"No connection between {start.name} and {goal.name}."]
    lines = [f"{len(edges)} step(s) from {start.name} to {goal.name}:"]
    for edge in edges:
        lines.append(f"  {describe(graph, edge.source)}  --{edge.kind}-->  {describe(graph, edge.target)}")
    return lines


def hubs_lines(graph: ag.Graph, limit: int) -> list[str]:
    """The most-connected functions and classes."""
    return [f"  {degree:4} links  {node.name}  ({where(node)})" for node, degree in ag.hubs(graph, max(1, limit))]


def check_lines(graph: ag.Graph) -> tuple[list[str], bool]:
    """Health checks as lines, and whether anything was found."""
    results = ag.health(graph)
    lines = []
    for name, found in results.items():
        lines.append(f"{name.replace('_', ' ')}: {len(found) or 'none ✓'}")
        lines += [f"  {node.name}  ({where(node)})" for node in sorted(found, key=lambda n: (n.file, n.line))]
    lines += [f"couldn't read: {error}" for error in graph.errors]
    return lines, any(results.values())


def communities_lines(graph: ag.Graph, limit: int) -> list[str]:
    """The subsystems: number, size and name, biggest first."""
    found = ag.communities(graph)
    if not found:
        return ["No communities (nothing is linked enough to group)."]
    lines = [f"  {c.id:3}  {len(c.members):4} members  {c.name}" for c in found[: max(1, limit)]]
    hidden = len(found) - len(lines)
    return lines + ([f"  … and {hidden} smaller ones"] if hidden > 0 else [])


# =============================================================================
# 05  COMMANDS
# =============================================================================
def cmd_build(args: argparse.Namespace) -> int:
    """Write the three outputs and print where they are."""
    graph = load_projects(args.project, args.name)
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


def cmd_answer(args: argparse.Namespace) -> int:
    """uses, deps, explain, path, hubs, communities: print the answer's lines."""
    graph = load_project(args.project)
    answers = {
        "uses": lambda: links_lines(graph, args.name, outgoing=False),
        "deps": lambda: links_lines(graph, args.name, outgoing=True),
        "explain": lambda: explain_lines(graph, args.name),
        "path": lambda: path_lines(graph, args.a, args.b),
        "hubs": lambda: hubs_lines(graph, args.n),
        "communities": lambda: communities_lines(graph, args.n),
    }
    print("\n".join(answers[args.command]()))
    return EXIT_OK


def cmd_check(args: argparse.Namespace) -> int:
    """Health checks; exit code 3 if anything was found (useful before committing)."""
    lines, found = check_lines(load_project(args.project))
    print("\n".join(lines))
    return EXIT_ISSUES if found else EXIT_OK


# =============================================================================
# 06  MAIN
# =============================================================================
COMMANDS = {
    "build": cmd_build, "uses": cmd_answer, "deps": cmd_answer, "explain": cmd_answer,
    "path": cmd_answer, "hubs": cmd_answer, "communities": cmd_answer, "check": cmd_check,
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
