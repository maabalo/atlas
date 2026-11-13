"""
Tests for Atlas — run from the Code_Map folder with:  python3 -m unittest -v

Most tests map tests/fixture/, a tiny project where every tricky case has a
known answer (calls inside template literals, spread calls, module imports,
decorators, default arguments, dynamic CSS class names, unused code, a
missing id). Standard library only, no network.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ATLAS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ATLAS_DIR))

import atlas  # noqa: E402
import atlas_app  # noqa: E402
import atlas_export  # noqa: E402
import atlas_graph as ag  # noqa: E402
import atlas_mcp  # noqa: E402
import atlas_scan as scan  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixture"


def run_cli(*argv: str) -> tuple[int, str, str]:
    """Run atlas.main with arguments; return (exit code, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = atlas.main(list(argv))
    return code, out.getvalue(), err.getvalue()


class GraphTest(unittest.TestCase):
    """The fixture's graph: nodes, links and their certainty."""

    @classmethod
    def setUpClass(cls):
        cls.graph = ag.build_graph(FIXTURE)

    def edge(self, source: str, target: str, kind: str) -> ag.Edge | None:
        """The edge between two node ids, if any."""
        return self.graph.edges.get((source, target, kind))

    def test_files_and_definitions_are_nodes(self):
        for node_id in ("file:index.html", "fn:assets/app.js::onGo", "class:pkg/main.py::Greeter",
                        "fn:pkg/main.py::Greeter.greet", "id:#goBtn", "css:.card"):  # fmt: skip
            self.assertIn(node_id, self.graph.nodes)

    def test_html_loads_its_script_and_stylesheet(self):
        self.assertTrue(self.edge("file:index.html", "file:assets/app.js", "loads"))
        self.assertTrue(self.edge("file:index.html", "file:assets/style.css", "loads"))

    def test_js_call_inside_a_template_literal(self):
        edge = self.edge("fn:assets/app.js::greet", "fn:assets/app.js::shout", "calls")
        self.assertEqual(edge.certainty, ag.CERTAIN)

    def test_js_spread_call_counts(self):
        self.assertTrue(self.edge("fn:assets/app.js::onGo", "fn:assets/app.js::parts", "calls"))

    def test_js_code_inside_a_string_is_not_a_call(self):
        self.assertEqual(self.graph.incoming("fn:assets/app.js::neverCalled")[0].kind, "declares")
        self.assertFalse(self.edge("fn:assets/app.js::neverCalled", "fn:assets/app.js::parts", "calls"))

    def test_js_callback_is_a_use(self):
        self.assertTrue(self.edge("file:assets/app.js", "fn:assets/app.js::onGo", "uses"))

    def test_python_module_attribute_call(self):
        edge = self.edge("fn:pkg/main.py::Greeter.format", "fn:pkg/helpers.py::tidy", "calls")
        self.assertEqual(edge.certainty, ag.CERTAIN)

    def test_python_self_method_call(self):
        self.assertTrue(self.edge("fn:pkg/main.py::Greeter.greet", "fn:pkg/main.py::Greeter.format", "calls"))

    def test_python_method_on_an_object_is_inferred(self):
        edge = self.edge("fn:pkg/main.py::run", "fn:pkg/main.py::Greeter.greet", "calls")
        self.assertEqual(edge.certainty, ag.INFERRED)

    def test_python_default_argument_and_decorator_are_uses(self):
        self.assertTrue(self.edge("fn:pkg/main.py::Greeter.greet", "fn:pkg/helpers.py::default_printer", "uses"))
        self.assertTrue(self.edge("fn:pkg/main.py::run", "fn:pkg/helpers.py::logged", "uses"))

    def test_python_imports_link_files(self):
        self.assertTrue(self.edge("file:pkg/main.py", "file:pkg/helpers.py", "imports"))
        self.assertTrue(self.edge("file:pkg/main.py", "file:pkg/__init__.py", "imports"))

    def test_dom_ids_and_classes(self):
        self.assertEqual(self.edge("file:assets/app.js", "id:#output", "uses").certainty, ag.CERTAIN)
        self.assertEqual(self.edge("file:assets/app.js", "css:.is-active", "uses").certainty, ag.CERTAIN)
        self.assertTrue(self.edge("file:index.html", "id:#nameInput", "uses"))  # <label for>

    def test_ids_created_by_javascript_are_declared(self):
        self.assertTrue(self.edge("file:assets/app.js", "id:#liveNote", "declares"))
        self.assertNotIn("id:#notAnId", self.graph.nodes)  # el.dataset.id = '…' is not an element id

    def test_hash_route_links_are_not_ids(self):
        self.assertNotIn("id:#/settings", self.graph.nodes)

    def test_dynamic_class_name_prefix_is_inferred(self):
        self.assertEqual(self.edge("file:assets/app.js", "css:.theme--dark", "uses").certainty, ag.INFERRED)

    def test_repeat_edges_are_counted_once(self):
        self.assertEqual(self.edge("file:assets/app.js", "id:#goBtn", "uses").count, 1)


class HealthTest(unittest.TestCase):
    """Exactly the fixture's deliberate problems, and nothing else."""

    def test_health_finds_exactly_the_planted_problems(self):
        found = {name: sorted(n.name for n in nodes) for name, nodes in ag.health(ag.build_graph(FIXTURE)).items()}
        self.assertEqual(found["unused_functions"], ["neverCalled", "orphan"])
        self.assertEqual(found["unused_css_classes"], [".unused-thing"])
        self.assertEqual(found["missing_ids"], ["#ghostHint"])

    def test_classes_from_external_libraries_are_not_unused(self):
        graph = ag.build_graph(FIXTURE)
        self.assertEqual(graph.libraries, {"widgetlib"})
        self.assertNotIn(".widgetlib-panel", {n.name for n in ag.health(graph)["unused_css_classes"]})

    def test_library_class_prefix_without_dashes(self):
        graph = ag.Graph(root="x", libraries={"maplibre-gl"})
        self.assertTrue(ag.from_library(graph, ag.Node("css:.maplibregl-map", "css-class", ".maplibregl-map")))
        self.assertFalse(ag.from_library(graph, ag.Node("css:.map", "css-class", ".map")))

    def test_library_names(self):
        self.assertEqual(scan.library_name("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"), "leaflet")
        self.assertEqual(scan.library_name("//cdn.x.org/chart.min.js?v=2"), "chart")
        self.assertEqual(scan.library_name("https://fonts.googleapis.com/css2?family=Inter"), "")

    def test_test_files_and_framework_hooks_are_entry_points(self):
        unused = {n.name for n in ag.health(ag.build_graph(FIXTURE))["unused_functions"]}
        self.assertNotIn("GreeterTest.helper_check", unused)
        self.assertNotIn("Greeter.__init__", unused)
        self.assertNotIn("main", unused)


class QueryTest(unittest.TestCase):
    """find_nodes, shortest_path and hubs."""

    @classmethod
    def setUpClass(cls):
        cls.graph = ag.build_graph(FIXTURE)

    def test_find_by_name_file_id_and_class(self):
        self.assertEqual([n.id for n in ag.find_nodes(self.graph, "shout")], ["fn:assets/app.js::shout"])
        self.assertEqual([n.id for n in ag.find_nodes(self.graph, "app.js")], ["file:assets/app.js"])
        self.assertEqual([n.id for n in ag.find_nodes(self.graph, "#goBtn")], ["id:#goBtn"])
        self.assertEqual([n.id for n in ag.find_nodes(self.graph, ".card")], ["css:.card"])
        self.assertEqual(ag.find_nodes(self.graph, "doesNotExist"), [])

    def test_shortest_path(self):
        path = ag.shortest_path(self.graph, "file:index.html", "fn:assets/app.js::shout")
        self.assertEqual([e.kind for e in path], ["loads", "declares"])

    def test_no_path_between_unconnected_nodes(self):
        self.assertEqual(ag.shortest_path(self.graph, "fn:assets/app.js::shout", "fn:pkg/helpers.py::orphan"), [])

    def test_hubs_are_sorted_by_links(self):
        degrees = [degree for _node, degree in ag.hubs(self.graph, 5)]
        self.assertEqual(degrees, sorted(degrees, reverse=True))


class ScanTest(unittest.TestCase):
    """Edge cases of the scanners on small inline sources."""

    def test_blank_js_keeps_code_inside_nested_templates(self):
        code, strings = scan.blank_js("const a = `x ${f(`y ${g()}`)} z`; // h()\nconst s = 'k()';")
        self.assertIn("f(", code)
        self.assertIn("g()", code)
        self.assertNotIn("h()", code)
        self.assertNotIn("k()", code)
        self.assertIn("k()", [text for text, _line in strings])

    def test_blank_js_keeps_offsets(self):
        source = "a('x');\n/* c */ b();"
        code, _strings = scan.blank_js(source)
        self.assertEqual(len(code), len(source))
        self.assertEqual(code.index("b()"), source.index("b()"))

    def test_syntax_errors_are_reported_not_raised(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "broken.py").write_text("def broken(:\n", encoding="utf-8")
            graph = ag.build_graph(Path(tmp))
        self.assertEqual(len(graph.errors), 1)
        self.assertIn("broken.py", graph.errors[0])

    def test_skipped_folders_and_relative_imports(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "node_modules").mkdir()
            Path(tmp, "node_modules", "lib.js").write_text("function x() {}", encoding="utf-8")
            Path(tmp, "pkg").mkdir()
            Path(tmp, "pkg", "a.py").write_text("from .b import helper\n\nhelper()\n", encoding="utf-8")
            Path(tmp, "pkg", "b.py").write_text("def helper():\n    pass\n", encoding="utf-8")
            graph = ag.build_graph(Path(tmp))
        self.assertNotIn("file:node_modules/lib.js", graph.nodes)
        self.assertIn(("file:pkg/a.py", "fn:pkg/b.py::helper", "calls"), graph.edges)


class CombinedTest(unittest.TestCase):
    """Several projects in one map: each keeps its own names, and they never link to each other."""

    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as other:
            Path(other, "index.html").write_text('<p id="greeting" class="card"></p><script src="app.js"></script>')
            Path(other, "app.js").write_text("function init() {}\ninit();\n")
            cls.other_name = Path(other).name
            cls.graph = ag.merge_graphs([ag.build_graph(FIXTURE), ag.build_graph(Path(other))], "both")

    def test_ids_and_paths_start_with_the_project(self):
        self.assertEqual(self.graph.projects, ["fixture", self.other_name])
        self.assertIn(f"file:{self.other_name}/app.js", self.graph.nodes)
        self.assertIn(f"fn:{self.other_name}/app.js::init", self.graph.nodes)
        self.assertEqual(self.graph.nodes[f"file:{self.other_name}/app.js"].name, f"{self.other_name}/app.js")

    def test_projects_never_link_to_each_other(self):
        for edge in self.graph.edges.values():
            source_project = edge.source.partition(":")[2].split("/")[0]
            self.assertEqual(source_project, edge.target.partition(":")[2].split("/")[0], edge)

    def test_health_still_works_per_project(self):
        missing = [n.id for n in ag.health(self.graph)["missing_ids"]]
        self.assertTrue(all(i.startswith("id:fixture/") for i in missing), missing)

    def test_cli_refuses_two_projects_with_the_same_name(self):
        code, _out, err = run_cli("build", str(FIXTURE), str(FIXTURE), "--out", tempfile.gettempdir())
        self.assertEqual(code, atlas.EXIT_ERROR)
        self.assertIn("share a folder name", err)


class FolderMapTests(unittest.TestCase):
    """Every folder and file is on the map, linked from the folder it's in."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name) / "site"
        (root / "assets").mkdir(parents=True)
        (root / "index.html").write_text('<script src="assets/app.js"></script>', encoding="utf-8")
        (root / "assets" / "app.js").write_text("function go() {}", encoding="utf-8")
        (root / "assets" / "logo.png").write_bytes(b"png")
        (root / "notes.md").write_text("# notes", encoding="utf-8")
        (root / ".DS_Store").write_bytes(b"junk")
        (root / "node_modules" / "lib").mkdir(parents=True)
        (root / "node_modules" / "lib" / "x.js").write_text("", encoding="utf-8")
        self.graph = ag.build_graph(root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_folders_and_every_file_are_nodes(self):
        types = {n.id: n.type for n in self.graph.nodes.values()}
        self.assertEqual(types["folder:."], "folder")
        self.assertEqual(self.graph.nodes["folder:."].name, "site")
        self.assertEqual(types["folder:assets"], "folder")
        for path in ("index.html", "assets/app.js", "assets/logo.png", "notes.md"):
            self.assertEqual(types[f"file:{path}"], "file")
        self.assertEqual(self.graph.nodes["file:assets/logo.png"].lang, "png")

    def test_junk_and_skipped_folders_are_left_out(self):
        ids = " ".join(self.graph.nodes)
        self.assertNotIn(".DS_Store", ids)
        self.assertNotIn("node_modules", ids)

    def test_each_folder_contains_its_items(self):
        contains = {(e.source, e.target) for e in self.graph.edges.values() if e.kind == "contains"}
        self.assertIn(("folder:.", "folder:assets"), contains)
        self.assertIn(("folder:.", "file:index.html"), contains)
        self.assertIn(("folder:assets", "file:assets/logo.png"), contains)

    def test_folder_links_dont_join_communities_or_paths(self):
        self.assertEqual(ag.shortest_path(self.graph, "file:notes.md", "file:assets/logo.png"), [])
        members = {m for c in ag.communities(self.graph) for m in c.members}
        self.assertNotIn("file:notes.md", members)

    def test_combined_maps_name_folders_after_their_project(self):
        merged = ag.merge_graphs([self.graph], "combined")
        self.assertEqual(merged.nodes["folder:site/."].name, "site")
        self.assertEqual(merged.nodes["folder:site/assets"].name, "site/assets")


class CommunityTest(unittest.TestCase):
    """Louvain communities: two tight groups joined by one link split in two, the same way every time."""

    @staticmethod
    def two_triangles() -> ag.Graph:
        graph = ag.Graph(root="t")
        for name in "abcxyz":
            graph.add_node(ag.Node(f"fn:t.js::{name}", "function", name, "t.js", 1, "javascript"))
        pairs = ["ab", "bc", "ca", "xy", "yz", "zx", "cx"]  # two triangles, one bridge
        for a, b in pairs:
            graph.add_edge(f"fn:t.js::{a}", f"fn:t.js::{b}", "calls", ag.CERTAIN)
        return graph

    def test_two_tight_groups_become_two_communities(self):
        found = ag.communities(self.two_triangles())
        groups = sorted("".join(sorted(m[-1] for m in c.members)) for c in found)
        self.assertEqual(groups, ["abc", "xyz"])

    def test_same_graph_same_communities(self):
        first = [c.members for c in ag.communities(ag.build_graph(FIXTURE))]
        self.assertEqual(first, [c.members for c in ag.communities(ag.build_graph(FIXTURE))])

    def test_names_start_with_the_main_file(self):
        for community in ag.communities(ag.build_graph(FIXTURE)):
            self.assertTrue(community.name.startswith(community.file.rsplit("/", 1)[-1]), community.name)

    def test_cli_and_json_list_them(self):
        code, out, _err = run_cli("communities", str(FIXTURE))
        self.assertEqual(code, atlas.EXIT_OK)
        self.assertIn("members", out)
        data = atlas_export.graph_to_dict(ag.build_graph(FIXTURE))
        self.assertTrue(data["meta"]["communities"])
        self.assertTrue(all("community" in node for node in data["nodes"]))


class McpTest(unittest.TestCase):
    """The MCP server: handshake, tool list, answers, and refusals (outside folders, bad input)."""

    ROOTS = [FIXTURE.parent.resolve()]

    def call(self, name: str, arguments: object) -> dict:
        message = {"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
        return atlas_mcp.handle(message, self.ROOTS)["result"]

    def test_initialize_and_tool_list(self):
        hello = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05"}}
        self.assertEqual(atlas_mcp.handle(hello, self.ROOTS)["result"]["protocolVersion"], "2024-11-05")
        listing = atlas_mcp.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, self.ROOTS)
        self.assertIn("atlas_explain", [t["name"] for t in listing["result"]["tools"]])
        self.assertIsNone(atlas_mcp.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}, self.ROOTS))

    def test_tools_answer_like_the_command_line(self):
        result = self.call("atlas_uses", {"project": "fixture", "name": "shout"})
        self.assertFalse(result["isError"])
        self.assertIn("greet", result["content"][0]["text"])
        self.assertFalse(self.call("atlas_overview", {"project": str(FIXTURE)})["isError"])

    def test_folders_outside_the_roots_are_refused(self):
        for project in ("/etc", "../..", "fixture/../../.."):
            result = self.call("atlas_check", {"project": project})
            self.assertTrue(result["isError"], project)
            self.assertIn("outside", result["content"][0]["text"])

    def test_bad_arguments_are_errors_not_crashes(self):
        bad = [
            ("atlas_hubs", {"project": "fixture", "limit": 0}),
            ("atlas_hubs", {"project": "fixture", "limit": True}),
            ("atlas_explain", {"project": "fixture"}),
            ("atlas_explain", {"project": "fixture", "name": "x" * 400}),
            ("atlas_check", {"project": "fixture", "extra": 1}),
            ("atlas_nope", {"project": "fixture"}),
            ("atlas_check", "not an object"),
        ]
        for name, arguments in bad:
            self.assertTrue(self.call(name, arguments)["isError"], (name, arguments))

    def test_unknown_method_and_bad_json(self):
        reply = atlas_mcp.handle({"jsonrpc": "2.0", "id": 3, "method": "resources/list"}, self.ROOTS)
        self.assertEqual(reply["error"]["code"], atlas_mcp.METHOD_NOT_FOUND)
        out = io.StringIO()
        atlas_mcp.serve(["not json\n"], self.ROOTS, out)
        self.assertEqual(json.loads(out.getvalue())["error"]["code"], atlas_mcp.PARSE_ERROR)

    def test_a_real_session_over_stdio(self):
        lines = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
             "params": {"name": "atlas_hubs", "arguments": {"project": "fixture", "limit": 3}}},
        ]  # fmt: skip
        stdin = "".join(json.dumps(line) + "\n" for line in lines)
        command = [sys.executable, str(ATLAS_DIR / "atlas_mcp.py"), "--root", str(FIXTURE.parent)]
        done = subprocess.run(command, input=stdin, capture_output=True, text=True, timeout=30, check=True)
        replies = [json.loads(line) for line in done.stdout.splitlines()]
        self.assertEqual([r["id"] for r in replies], [1, 2])
        self.assertIn("links", replies[1]["result"]["content"][0]["text"])


class ExportTest(unittest.TestCase):
    """The three output files."""

    def test_script_json_cannot_close_the_script_tag(self):
        text = atlas_export.safe_script_json({"name": "</script><b>"})
        self.assertNotIn("<", text)
        self.assertEqual(json.loads(text)["name"], "</script><b>")

    def test_write_outputs(self):
        graph = ag.build_graph(FIXTURE)
        with tempfile.TemporaryDirectory() as tmp:
            paths = atlas_export.write_outputs(graph, Path(tmp) / "map")
            data = json.loads(paths["json"].read_text(encoding="utf-8"))
            report = paths["report"].read_text(encoding="utf-8")
            page = paths["html"].read_text(encoding="utf-8")
        self.assertEqual(len(data["nodes"]), len(graph.nodes))
        self.assertIn("## Health checks", report)
        self.assertIn("`orphan`", report)
        self.assertNotIn('src="app.js"', page)
        self.assertNotIn('src="core.js"', page)
        self.assertNotIn('href="style.css"', page)
        self.assertIn('"project":"fixture"', page)
        self.assertIn("window.AtlasCore", page)  # core.js inlined before app.js
        self.assertLess(page.index("root.AtlasCore = factory()"), page.index("} = window.AtlasCore;"))

    def test_map_page_allows_only_its_own_scripts(self):
        page = atlas_export.html_page(ag.build_graph(FIXTURE))
        policy = re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', page).group(1)
        self.assertIn("default-src 'none'", policy)
        self.assertNotIn("unsafe-inline", policy)
        for body in re.findall(r"<script>(.*?)</script>", page, flags=re.S):  # every inline script is allowed by hash
            digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
            self.assertIn(f"'sha256-{digest}'", policy)
        self.assertLess(page.index("Content-Security-Policy"), page.index("<script"))  # in force before any script


class ClaudeTouchesTest(unittest.TestCase):
    """Files Claude edited or created, read from Claude Code's session logs (only tool names and file paths)."""

    @staticmethod
    def tool_line(name: str, path: str) -> str:
        part = {"type": "tool_use", "name": name, "input": {"file_path": path, "old_string": "private text"}}
        return json.dumps({"type": "assistant", "message": {"content": [part]}})

    def test_counts_edits_and_writes_of_files_on_the_map(self):
        graph = ag.build_graph(FIXTURE)
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / "-Users-me" / "session.jsonl"
            log.parent.mkdir()
            lines = [
                self.tool_line("Edit", str(FIXTURE / "index.html")),
                self.tool_line("Edit", str(FIXTURE / "index.html")),
                self.tool_line("Write", str(FIXTURE / "pkg" / "main.py")),
                self.tool_line("Read", str(FIXTURE / "pkg" / "main.py")),  # reading doesn't count
                self.tool_line("Edit", "/somewhere/else/secret.py"),  # outside the map: ignored
                '{"broken json "tool_use" "file_path"',  # a damaged line is skipped
                json.dumps({"message": {"content": "just text"}}),
            ]
            log.write_text("\n".join(lines))
            touches = atlas.claude_touches(Path(folder), [str(FIXTURE)], graph)
        self.assertEqual(touches["file:index.html"], {"edits": 2, "writes": 0})
        self.assertEqual(touches["file:pkg/main.py"], {"edits": 0, "writes": 1})
        self.assertEqual(len(touches), 2)

    def test_no_logs_means_no_touches(self):
        graph = ag.build_graph(FIXTURE)
        self.assertEqual(atlas.claude_touches(Path("/no/such/folder"), [str(FIXTURE)], graph), {})


class CliTest(unittest.TestCase):
    """Commands, messages and exit codes."""

    def test_check_exits_3_when_something_is_found(self):
        code, out, _err = run_cli("check", str(FIXTURE))
        self.assertEqual(code, atlas.EXIT_ISSUES)
        self.assertIn("orphan", out)

    def test_uses_and_explain(self):
        code, out, _err = run_cli("uses", str(FIXTURE), "shout")
        self.assertEqual(code, atlas.EXIT_OK)
        self.assertIn("greet", out)
        self.assertEqual(run_cli("explain", str(FIXTURE), "Greeter")[0], atlas.EXIT_OK)

    def test_ambiguous_name_lists_the_choices(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name in ("a.py", "b.py"):
                Path(tmp, name).write_text("def helper():\n    pass\n", encoding="utf-8")
            code, _out, err = run_cli("uses", tmp, "helper")
        self.assertEqual(code, atlas.EXIT_ERROR)
        self.assertIn("fn:a.py::helper", err)
        self.assertIn("fn:b.py::helper", err)

    def test_unknown_name_and_missing_folder(self):
        code, _out, err = run_cli("uses", str(FIXTURE), "nope")
        self.assertEqual(code, atlas.EXIT_ERROR)
        self.assertIn("Nothing called", err)
        code, _out, err = run_cli("check", str(FIXTURE / "missing"))
        self.assertEqual(code, atlas.EXIT_ERROR)
        self.assertIn("Not a folder", err)

    def test_build_writes_to_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out, _err = run_cli("build", str(FIXTURE), "--out", tmp)
            self.assertEqual(code, atlas.EXIT_OK)
            self.assertTrue(Path(tmp, "graph.html").is_file())
        self.assertIn("Mapped fixture", out)


class AppLauncherTests(unittest.TestCase):
    """The Mac app's launcher (atlas_app.py), with macOS dialogs replaced by fakes."""

    def test_cancelling_the_folder_picker_does_nothing(self):
        result = subprocess.CompletedProcess([], 1, "", "execution error: User canceled. (-128)")
        with mock.patch.object(atlas_app, "run_applescript", return_value=result):
            self.assertIsNone(atlas_app.choose_folder())
            with mock.patch.object(atlas_app, "my_projects", return_value=[]):
                self.assertEqual(atlas_app.main([]), atlas.EXIT_OK)

    @mock.patch.object(atlas_app, "my_projects", return_value=[])
    def test_a_broken_picker_is_reported(self, _projects):
        result = subprocess.CompletedProcess([], 1, "", "execution error: no window server (-1)")
        with mock.patch.object(atlas_app, "run_applescript", return_value=result) as script:
            self.assertEqual(atlas_app.main([]), atlas.EXIT_ERROR)
        self.assertIn("no window server", script.call_args.args[-1])

    @mock.patch.object(atlas_app, "run_applescript")
    @mock.patch("webbrowser.open")
    def test_builds_the_map_in_the_app_folder_and_opens_it(self, opened, _script):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(atlas_app, "MAPS_DIR", Path(folder)):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(atlas_app.main([str(FIXTURE)]), atlas.EXIT_OK)
            self.assertTrue((Path(folder) / FIXTURE.name / "graph.html").is_file())
            opened.assert_called_once()

    def test_finds_every_project_except_atlas_itself(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            for name in ("00/Code_Map", "01/Camp", "01/Next", "07/New", "Resume_page", "Claude_Backup", "01/.hidden"):
                (home / name).mkdir(parents=True)
            found = [str(path.relative_to(home)) for path in atlas_app.my_projects(home)]
        self.assertEqual(found, ["01/Camp", "01/Next", "07/New", "Resume_page"])

    def test_no_projects_folder_means_no_projects(self):
        self.assertEqual(atlas_app.my_projects(Path("/no/such/folder")), [])

    @mock.patch.object(atlas_app, "run_applescript")
    @mock.patch("webbrowser.open")
    def test_double_click_builds_one_combined_map(self, _opened, _script):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(atlas_app, "MAPS_DIR", Path(folder)):
            with (
                mock.patch.object(atlas_app, "my_projects", return_value=[FIXTURE]),
                mock.patch.object(atlas_app, "SATELLITE", Path(folder) / "no-such-folder"),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(atlas_app.main([]), atlas.EXIT_OK)
            self.assertTrue((Path(folder) / atlas_app.COMBINED_NAME / "graph.html").is_file())

    @mock.patch.object(atlas_app, "run_applescript")
    @mock.patch("webbrowser.open")
    def test_double_click_adds_the_claude_folder_as_a_moon(self, _opened, _script):
        with tempfile.TemporaryDirectory() as folder:
            moon = Path(folder) / ".claude"
            (moon / "skills").mkdir(parents=True)
            (moon / "skills" / "tool.py").write_text("def helper():\n    return 1\n")
            chat = moon / "projects" / "-Users-me" / "0a1b2c3d-1111-2222-3333-444455556666"
            chat.mkdir(parents=True)
            (chat / "notes.md").write_text("private")
            edit = {"type": "tool_use", "name": "Edit", "input": {"file_path": str(FIXTURE / "index.html")}}
            (chat.parent / "0a1b2c3d-1111-2222-3333-444455556666.jsonl").write_text(
                json.dumps({"message": {"content": [edit]}})
            )
            (chat.parent / "memory").mkdir()
            (chat.parent / "memory" / "MEMORY.md").write_text("- a note")
            (moon / "file-history").mkdir()
            (moon / "file-history" / "old.txt").write_text("x")
            with (
                mock.patch.object(atlas_app, "MAPS_DIR", Path(folder) / "maps"),
                mock.patch.object(atlas_app, "my_projects", return_value=[FIXTURE]),
                mock.patch.object(atlas_app, "SATELLITE", moon),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(atlas_app.main([]), atlas.EXIT_OK)
            data = json.loads((Path(folder) / "maps" / atlas_app.COMBINED_NAME / "graph.json").read_text())
        self.assertEqual(data["meta"]["satellite"], ".claude")
        ids = {node["id"] for node in data["nodes"]}
        self.assertIn("file:.claude/skills/tool.py", ids)
        self.assertIn("file:.claude/projects/-Users-me/memory/MEMORY.md", ids)  # memory notes stay
        noise = [i for i in ids if "0a1b2c3d" in i or "file-history" in i]  # conversations and history don't
        self.assertEqual(noise, [])
        # the session log isn't on the map, but which map files Claude edited is: rays from the core
        self.assertEqual(data["meta"]["claude_touches"], {"file:fixture/index.html": {"edits": 1, "writes": 0}})

    def test_a_missing_folder_shows_the_problem(self):
        with mock.patch.object(atlas_app, "run_applescript") as script:
            self.assertEqual(atlas_app.main(["/no/such/folder"]), atlas.EXIT_ERROR)
        self.assertIn("/no/such/folder", script.call_args.args[-1])


if __name__ == "__main__":
    unittest.main()
