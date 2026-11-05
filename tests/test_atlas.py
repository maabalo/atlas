"""
Tests for Atlas — run from the Code_Map folder with:  python3 -m unittest -v

Most tests map tests/fixture/, a tiny project where every tricky case has a
known answer (calls inside template literals, spread calls, module imports,
decorators, default arguments, dynamic CSS class names, unused code, a
missing id). Standard library only, no network.
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ATLAS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ATLAS_DIR))

import atlas  # noqa: E402
import atlas_export  # noqa: E402
import atlas_graph as ag  # noqa: E402
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
        self.assertNotIn('href="style.css"', page)
        self.assertIn('"project":"fixture"', page)


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


if __name__ == "__main__":
    unittest.main()
