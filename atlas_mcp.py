#!/usr/bin/env python3
"""
Atlas — atlas_mcp.py: an MCP server, so Claude Code (or any MCP client) can ask
Atlas about a project directly instead of searching through files.

Standard library only: MCP over stdio is JSON-RPC 2.0, one message per line.
Read-only: it maps projects and answers; it never writes anywhere.
Least privilege: only projects inside the allowed folders can be mapped
(--root, which can be given more than once; default: the folder it starts in).
Every argument is treated as untrusted (Claude may be acting on text from a file).

    claude mcp add atlas -- python3 /path/to/atlas_mcp.py --root ~/Documents/Web_Page

TABLE OF CONTENTS
  01  Settings & tool list
  02  Checking arguments
  03  Running a tool
  04  JSON-RPC messages
  05  Main loop
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

import atlas
import atlas_graph as ag

# =============================================================================
# 01  SETTINGS & TOOL LIST
# =============================================================================
SERVER_INFO = {"name": "atlas", "version": "1.1.0"}
PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")  # newest first
MAX_LINES = 300  # longest answer sent back (a hub can have hundreds of links)
MAX_TEXT = 300  # longest name or path accepted
PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INTERNAL_ERROR = -32700, -32600, -32601, -32603

PROJECT = {"type": "string", "description": "Project folder (absolute, or relative to the first allowed folder)."}
NAME = {
    "type": "string",
    "description": "A function (renderCode), method (Class.method), file (app.js), #id or .class.",
}
LIMIT = {"type": "integer", "minimum": 1, "maximum": 100, "description": "How many to list."}


def tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    """One tool's description for tools/list."""
    schema = {"type": "object", "properties": properties, "required": required, "additionalProperties": False}
    return {"name": name, "description": description, "inputSchema": schema}


TOOLS = [
    tool("atlas_overview", "Counts, biggest hubs, communities and health of a project: start here.",
         {"project": PROJECT}, ["project"]),
    tool("atlas_explain", "Everything about one thing: where it is defined, its community, what uses it "
         "and what it uses.", {"project": PROJECT, "name": NAME}, ["project", "name"]),
    tool("atlas_uses", "What uses NAME: who calls, loads, styles or imports it (impact of changing it).",
         {"project": PROJECT, "name": NAME}, ["project", "name"]),
    tool("atlas_deps", "What NAME uses: the functions, files, ids and classes it depends on.",
         {"project": PROJECT, "name": NAME}, ["project", "name"]),
    tool("atlas_path", "The shortest chain of links between two things.",
         {"project": PROJECT, "from": NAME, "to": NAME}, ["project", "from", "to"]),
    tool("atlas_hubs", "The most-connected functions and classes: the riskiest to change.",
         {"project": PROJECT, "limit": LIMIT}, ["project"]),
    tool("atlas_communities", "Subsystems: groups of code linked mostly to each other, biggest first.",
         {"project": PROJECT, "limit": LIMIT}, ["project"]),
    tool("atlas_check", "Health checks: unused functions, unused CSS classes, ids used but never declared.",
         {"project": PROJECT}, ["project"]),
]  # fmt: skip


class ToolError(Exception):
    """A refusal with a message that is safe to send back."""


# =============================================================================
# 02  CHECKING ARGUMENTS
# =============================================================================
def checked_arguments(name: str, arguments: object) -> dict:
    """The arguments, checked against the tool's schema (types, required, nothing extra, limits)."""
    spec = next((t for t in TOOLS if t["name"] == name), None)
    if not spec:
        raise ToolError(f"Unknown tool: {str(name)[:MAX_TEXT]}")
    if not isinstance(arguments, dict):
        raise ToolError("Arguments must be an object.")
    schema = spec["inputSchema"]
    extra = sorted(set(arguments) - set(schema["properties"]))
    missing = [key for key in schema["required"] if key not in arguments]
    if extra or missing:
        raise ToolError(f"Unexpected: {extra or 'none'}. Missing: {missing or 'none'}.")
    for key, value in arguments.items():
        check_value(key, value, schema["properties"][key])
    return arguments


def check_value(key: str, value: object, prop: dict) -> None:
    """One argument: a short non-empty string, or a whole number within its limits."""
    if prop["type"] == "string":
        if not isinstance(value, str) or not value.strip() or len(value) > MAX_TEXT:
            raise ToolError(f'"{key}" must be a non-empty string of at most {MAX_TEXT} characters.')
        return
    if isinstance(value, bool) or not isinstance(value, int) or not prop["minimum"] <= value <= prop["maximum"]:
        raise ToolError(f'"{key}" must be a whole number from {prop["minimum"]} to {prop["maximum"]}.')


def allowed_project(value: str, roots: list[Path]) -> Path:
    """The project folder, only if it is (inside) an allowed folder: ../ tricks and links are resolved first."""
    candidate = Path(value).expanduser()
    resolved = (candidate if candidate.is_absolute() else roots[0] / candidate).resolve()
    if not any(resolved == root or root in resolved.parents for root in roots):
        allowed = ", ".join(str(root) for root in roots)
        raise ToolError(f"That folder is outside the folders Atlas may read ({allowed}).")
    if not resolved.is_dir():
        raise ToolError(f"Not a folder: {resolved}")
    return resolved


# =============================================================================
# 03  RUNNING A TOOL
# =============================================================================
def answer_lines(name: str, arguments: dict, graph: ag.Graph) -> list[str]:
    """The answer for one tool, as text lines (the same answers as the command line)."""
    limit = arguments.get("limit", 10 if name == "atlas_hubs" else 15)
    answers = {
        "atlas_overview": lambda: overview_lines(graph),
        "atlas_explain": lambda: atlas.explain_lines(graph, arguments.get("name", "")),
        "atlas_uses": lambda: atlas.links_lines(graph, arguments.get("name", ""), outgoing=False),
        "atlas_deps": lambda: atlas.links_lines(graph, arguments.get("name", ""), outgoing=True),
        "atlas_path": lambda: atlas.path_lines(graph, arguments.get("from", ""), arguments.get("to", "")),
        "atlas_hubs": lambda: atlas.hubs_lines(graph, limit),
        "atlas_communities": lambda: atlas.communities_lines(graph, limit),
        "atlas_check": lambda: atlas.check_lines(graph)[0],
    }
    return answers[name]()


def overview_lines(graph: ag.Graph) -> list[str]:
    """Counts, top hubs, communities and health in one answer."""
    counts = {}
    for node in graph.nodes.values():
        counts[node.type] = counts.get(node.type, 0) + 1
    summary = ", ".join(f"{count} {kind}" for kind, count in sorted(counts.items()))
    health = atlas.check_lines(graph)[0]
    return [
        f"{Path(graph.root).name}: {summary}, {len(graph.edges)} links.", "", "hubs:", *atlas.hubs_lines(graph, 5),
        "", "communities:", *atlas.communities_lines(graph, 8), "", "health:",
        *[line for line in health if not line.startswith("  ")],
    ]  # fmt: skip


def call_tool(params: object, roots: list[Path]) -> dict:
    """tools/call: check, map the project, answer. Problems come back as an error result, not a crash."""
    try:
        if not isinstance(params, dict):
            raise ToolError("Missing the tool name and arguments.")
        name = params.get("name")
        arguments = checked_arguments(name, params.get("arguments", {}))
        graph = atlas.load_project(str(allowed_project(arguments["project"], roots)))
        return text_result(trimmed(answer_lines(name, arguments, graph)), is_error=False)
    except (ToolError, atlas.AtlasError) as error:
        return text_result([str(error)], is_error=True)
    except OSError as error:
        return text_result([f"Couldn't read the project: {error.strerror}"], is_error=True)


def trimmed(lines: list[str]) -> list[str]:
    """At most MAX_LINES lines, saying how many were left out."""
    if len(lines) <= MAX_LINES:
        return lines
    return lines[:MAX_LINES] + [f"… {len(lines) - MAX_LINES} more lines (ask about something more specific)"]


def text_result(lines: list[str], is_error: bool) -> dict:
    """A tools/call result: one text block."""
    return {"content": [{"type": "text", "text": "\n".join(lines)}], "isError": is_error}


# =============================================================================
# 04  JSON-RPC MESSAGES
# =============================================================================
def handle(message: object, roots: list[Path]) -> dict | None:
    """The response to one message, or None for notifications (they never get one)."""
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or not isinstance(message.get("method"), str):
        return error_response(None, INVALID_REQUEST, "Not a JSON-RPC 2.0 request.")
    method, params = message["method"], message.get("params") or {}
    if "id" not in message:
        return None  # e.g. notifications/initialized
    if method == "initialize":
        return result_response(message["id"], initialize_result(params))
    if method == "ping":
        return result_response(message["id"], {})
    if method == "tools/list":
        return result_response(message["id"], {"tools": TOOLS})
    if method == "tools/call":
        return result_response(message["id"], call_tool(params, roots))
    return error_response(message["id"], METHOD_NOT_FOUND, f"Unknown method: {method[:MAX_TEXT]}")


def initialize_result(params: object) -> dict:
    """Agree on a protocol version (the client's, when we support it) and say we offer tools."""
    asked = params.get("protocolVersion") if isinstance(params, dict) else None
    version = asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0]
    return {"protocolVersion": version, "capabilities": {"tools": {}}, "serverInfo": SERVER_INFO}


def result_response(message_id: object, result: dict) -> dict:
    """A successful JSON-RPC response."""
    return {"jsonrpc": "2.0", "id": message_id, "result": result}


def error_response(message_id: object, code: int, text: str) -> dict:
    """A JSON-RPC error response."""
    return {"jsonrpc": "2.0", "id": message_id, "error": {"code": code, "message": text}}


# =============================================================================
# 05  MAIN LOOP
# =============================================================================
def parse_roots(argv: list[str] | None) -> list[Path]:
    """The allowed folders (--root, repeatable; default: the current folder), resolved."""
    parser = argparse.ArgumentParser(prog="atlas_mcp.py", description="Atlas as an MCP server (stdio).")
    parser.add_argument("--root", action="append", help="a folder whose projects may be mapped (repeatable)")
    roots = [Path(root).expanduser().resolve() for root in (parser.parse_args(argv).root or ["."])]
    missing = [str(root) for root in roots if not root.is_dir()]
    if missing:
        parser.error(f"not a folder: {', '.join(missing)}")
    return roots


def serve(lines, roots: list[Path], out) -> None:
    """Answer each line of input (one JSON-RPC message per line) with one line of output."""
    for line in lines:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            response = error_response(None, PARSE_ERROR, "That wasn't valid JSON.")
        else:
            response = handle_safely(message, roots)
        if response is not None:
            out.write(json.dumps(response, ensure_ascii=False) + "\n")
            out.flush()


def handle_safely(message: object, roots: list[Path]) -> dict | None:
    """handle(), but an unexpected bug answers with an error (details in the log) instead of
    stopping the server, so the client keeps its connection."""
    try:
        return handle(message, roots)
    except Exception:  # noqa: BLE001 - deliberately broad: the server must keep running
        traceback.print_exc(file=sys.stderr)
        message_id = message.get("id") if isinstance(message, dict) else None
        return error_response(message_id, INTERNAL_ERROR, "Atlas hit an unexpected problem (details in its log).")


def main(argv: list[str] | None = None) -> int:
    """Serve on stdin/stdout until the client closes the connection. Logs go to stderr only."""
    roots = parse_roots(argv)
    print(f"Atlas MCP server: reading projects inside {', '.join(map(str, roots))}", file=sys.stderr)
    serve(sys.stdin, roots, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
