"""
Atlas — atlas_live.py: keep an open map up to date (Atlas.app uses this).

While a map is open, this serves its folder at http://127.0.0.1:PORT/ (this Mac only, never the network),
watches the mapped folders every few seconds, and rebuilds the map once a change has settled. The open page
asks /version every few seconds and, when the map's contents changed, reloads itself keeping its view, so new
dust appears without reopening Atlas. It stops by itself a few minutes after the page is closed (nothing asks
any more). Standard library only.

TABLE OF CONTENTS
  01  Settings
  02  Noticing changes
  03  The local server
  04  Running a live map
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import socketserver
import threading
import time
import urllib.request
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import atlas_scan

# =============================================================================
# 01  SETTINGS
# =============================================================================
HOST = "127.0.0.1"  # this Mac only
WATCH_SECONDS = 3  # how often the folders are checked (a check takes ~15 ms on the Project map)
MIN_REBUILD_SECONDS = 10  # at most one rebuild this often (a rebuild takes ~4 s on the Project map)
IDLE_SECONDS = 180  # stop when no page has asked for this long (browsers slow hidden tabs to ~1 ask a minute)
LIVE_FILE = "live.json"  # in the map's folder: the port of the running live map, so a second double-click reuses it
PING_REPLY = b"atlas"

Roots = Callable[[], list[tuple[Path, tuple[str, ...]]]]  # (folder, skip patterns) to watch, worked out each time


# =============================================================================
# 02  NOTICING CHANGES
# =============================================================================
def folder_signature(roots: list[tuple[Path, tuple[str, ...]]]) -> str:
    """A fingerprint of every folder and file Atlas would map under `roots` (path, size and time changed): it
    changes when anything is added, removed, renamed or saved."""
    digest = hashlib.sha1()
    for root, skip in roots:
        if not root.is_dir():
            continue
        folders, files = atlas_scan.find_all_files(root, skip)
        for path in [*folders, *files]:
            try:
                info = path.stat()
            except OSError:  # removed while looking
                continue
            digest.update(f"{path}\0{info.st_mtime_ns}\0{info.st_size}\n".encode())
    return digest.hexdigest()


def map_version(json_path: Path) -> str:
    """A fingerprint of what's on a map (its items and links, not line numbers or dates): the page reloads only
    when this changes, so saving a file without adding or removing anything doesn't reload it."""
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    ids = sorted(node["id"] for node in data.get("nodes", []))
    links = sorted(f"{edge['source']}\0{edge['kind']}\0{edge['target']}" for edge in data.get("edges", []))
    return hashlib.sha1("\n".join([*ids, "", *links]).encode()).hexdigest()


# =============================================================================
# 03  THE LOCAL SERVER — only the map page, its version and a ping
# =============================================================================
class LiveMap:
    """One map folder being served: what the page asks for, and when it last asked."""

    def __init__(self, folder: Path):
        self.folder = folder
        self.version = map_version(folder / "graph.json")
        self.last_seen = time.monotonic()
        self.hosts: set[str] = set()  # the Host headers allowed (set once the port is known)


class LocalServer(ThreadingHTTPServer):
    """http.server's threaded server, minus its start-up look-up of this computer's network name (it can hang
    for a long time inside a Mac app, and a server on 127.0.0.1 doesn't need it)."""

    def server_bind(self) -> None:
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = HOST, self.server_address[1]


class MapRequests(BaseHTTPRequestHandler):
    """Answers GET / (the map), /version and /ping, and nothing else. Requests must name this Mac's own address
    as their Host, so another website can't reach the map through a look-alike domain (DNS rebinding)."""

    server_version = "Atlas"
    sys_version = ""

    def do_GET(self) -> None:  # the name http.server expects
        live: LiveMap = self.server.live  # type: ignore[attr-defined]
        if self.headers.get("Host") not in live.hosts:
            self.send_error(403)
            return
        path = self.path.split("?", 1)[0]
        if path in ("/", "/graph.html"):
            live.last_seen = time.monotonic()
            try:
                page = (live.folder / "graph.html").read_bytes()
            except OSError:
                self.send_error(404)
                return
            self.reply(page, "text/html; charset=utf-8")
        elif path == "/version":
            live.last_seen = time.monotonic()
            self.reply(live.version.encode(), "text/plain; charset=utf-8")
        elif path == "/ping":  # a second Atlas checking this one is still running
            self.reply(PING_REPLY, "text/plain; charset=utf-8")
        else:
            self.send_error(404)

    def reply(self, body: bytes, content_type: str) -> None:
        """Send `body`, never cached, with the browser told not to guess types or share it with other sites."""
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # http.server's names
        """Quiet: an app has no Terminal to print to."""


def running_url(folder: Path) -> str | None:
    """The address of a live map of `folder` that's already running (from its live.json), or None."""
    try:
        port = int(json.loads((folder / LIVE_FILE).read_text(encoding="utf-8"))["port"])
        url = f"http://{HOST}:{port}/"
        direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # this Mac: never through a proxy
        with direct.open(f"{url}ping", timeout=1) as answer:
            return url if answer.read() == PING_REPLY else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


# =============================================================================
# 04  RUNNING A LIVE MAP
# =============================================================================
def watch(live: LiveMap, rebuild: Callable[[], object], roots: Roots, sleep=time.sleep, clock=time.monotonic) -> None:
    """Check the folders every WATCH_SECONDS until no page has asked for IDLE_SECONDS. A change is rebuilt once
    it has stayed the same for one check (so a burst of saves is one rebuild), at most every MIN_REBUILD_SECONDS."""
    seen = folder_signature(roots())
    pending = None
    last_build = clock()
    while clock() - live.last_seen < IDLE_SECONDS:
        sleep(WATCH_SECONDS)
        current = folder_signature(roots())
        if current == seen:
            pending = None
            continue
        if current != pending or clock() - last_build < MIN_REBUILD_SECONDS:
            pending = current  # still changing (or too soon): wait for it to settle
            continue
        with contextlib.suppress(Exception):  # a failed rebuild keeps the last good map; the next change tries again
            rebuild()
        live.version = map_version(live.folder / "graph.json")
        seen, pending, last_build = current, None, clock()


def serve(folder: Path, rebuild: Callable[[], object], roots: Roots, open_page: Callable[[str], object]) -> None:
    """Serve the map in `folder`, open it with `open_page(url)`, and keep it up to date until it's closed."""
    live = LiveMap(folder)
    server = LocalServer((HOST, 0), MapRequests)
    server.live = live  # type: ignore[attr-defined]
    port = server.server_address[1]
    live.hosts = {f"{HOST}:{port}", f"localhost:{port}"}
    marker = folder / LIVE_FILE
    marker.write_text(json.dumps({"port": port, "pid": os.getpid()}), encoding="utf-8")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        open_page(f"http://{HOST}:{port}/")
        watch(live, rebuild, roots)
    finally:
        server.shutdown()
        server.server_close()
        try:
            if json.loads(marker.read_text(encoding="utf-8")).get("pid") == os.getpid():
                marker.unlink()  # only our own marker (a newer Atlas may have replaced it)
        except (OSError, ValueError):
            pass
