"""
Atlas.app launcher: double-click and the map of all your projects opens in the browser.

This is what the Mac app runs (packaging/build_app.sh). It rebuilds one combined
map of ~/Documents/Project each time, so the map is always current. On a Mac
without that folder it asks which folder to map instead. On top of `atlas.py
build` it adds only what a double-click needs: finding the projects, a place to
save maps (the app's own folder is read-only), and error messages in a dialog
because an app has no Terminal to print to.

Dialogs use macOS's own osascript, so Atlas still needs only the standard library.
Text is passed as arguments, never pasted into the script, so a folder or error
containing quotes can't change what runs.
"""

from __future__ import annotations

import contextlib
import io
import subprocess
import sys
from pathlib import Path

import atlas

MAPS_DIR = Path.home() / "Library" / "Application Support" / "Atlas" / "maps"
PROJECTS_HOME = Path.home() / "Documents" / "Project"
ATLAS_OWN_FOLDER = "00"  # Atlas itself isn't part of the map
PORTFOLIO_FOLDER = "Resume_page"  # the one project outside the numbered folders
COMBINED_NAME = "Project"
SATELLITE = Path.home() / ".claude"  # Claude's own folder: drawn as the core inside the Project globe (user's choice)
# Left out of the moon: saved conversations (folders named by id, and *.jsonl logs), file history, caches, session
# files and backups. They're noise on the map and private; instructions, skills, plugins and memory notes stay.
SATELLITE_SKIP = (
    "????????-????-????-????-????????????",
    "*.jsonl",
    "file-history",
    "cache",
    "paste-cache",
    "telemetry",
    "statsig",
    "session-env",
    "sessions",
    "shell-snapshots",
    "todos",
    "debug",
    "backups",
    "skill-backups",
    "ide",
)
OSASCRIPT = "/usr/bin/osascript"
USER_CANCELLED = "-128"  # AppleScript's error number when Cancel is pressed


def run_applescript(lines: list[str], *args: str) -> subprocess.CompletedProcess:
    """Run AppleScript lines with `args` available as `item N of argv`."""
    command = [OSASCRIPT]
    for line in ["on run argv", *lines, "end run"]:
        command += ["-e", line]
    return subprocess.run([*command, *args], capture_output=True, text=True, check=False)


def choose_folder() -> Path | None:
    """Ask for a project folder; None if the person pressed Cancel."""
    script = ['return POSIX path of (choose folder with prompt "Choose a project folder to map")']
    result = run_applescript(script)
    if result.returncode == 0:
        return Path(result.stdout.strip())
    if USER_CANCELLED in result.stderr:
        return None
    raise RuntimeError(f"The folder picker didn't open: {result.stderr.strip()}")


def show_error(message: str) -> None:
    """Show a problem in a dialog."""
    run_applescript(['display alert "Atlas couldn\'t make the map" message (item 1 of argv) as critical'], message)


def notify_started(name: str) -> None:
    """Say the map is being made, since a big project can take a while."""
    run_applescript(['display notification (item 1 of argv) with title "Atlas"'], f"Mapping {name}…")


def my_projects(home: Path = PROJECTS_HOME) -> list[Path]:
    """Every project: the folders inside each numbered folder (except Atlas's own), plus the portfolio."""
    numbered = [folder for folder in sorted(home.glob("[0-9][0-9]")) if folder.name != ATLAS_OWN_FOLDER]
    projects = [
        child
        for folder in numbered
        if folder.is_dir()
        for child in sorted(folder.iterdir())
        if child.is_dir() and not child.name.startswith(".")
    ]
    portfolio = home / PORTFOLIO_FOLDER
    return [*projects, portfolio] if portfolio.is_dir() else projects


def single_project(folder: Path) -> tuple[list[Path], str]:
    """One folder as a map target, named after it (the filesystem root has no name)."""
    return [folder], folder.resolve().name or "root"


def choose_target(args: list[str]) -> tuple[list[Path], str] | None:
    """(projects, map name): a folder given as an argument, all your projects, or a chosen folder."""
    if args:
        return single_project(Path(args[0]))
    projects = my_projects()
    if projects:
        return projects, COMBINED_NAME
    folder = choose_folder()
    return single_project(folder) if folder else None


def build_map(projects: list[Path], name: str) -> str | None:
    """Build the map and open it; returns the problem as text, or None if it worked."""
    errors = io.StringIO()
    folders = [str(project) for project in projects]
    moon = []
    if name == COMBINED_NAME and SATELLITE.is_dir():
        moon = [
            "--satellite",
            str(SATELLITE),
            *[arg for pattern in SATELLITE_SKIP for arg in ("--satellite-skip", pattern)],
        ]
        logs = SATELLITE / "projects"  # Claude Code's session logs: only which files Claude edited or created is read
        if logs.is_dir():
            moon += ["--claude-log", str(logs)]
    with contextlib.redirect_stderr(errors):
        code = atlas.main(["build", *folders, *moon, "--name", name, "--out", str(MAPS_DIR / name), "--open"])
    return None if code == atlas.EXIT_OK else errors.getvalue().strip() or "Something went wrong."


def main(argv: list[str] | None = None) -> int:
    """Work out what to map, then make the map."""
    args = sys.argv[1:] if argv is None else argv
    try:
        target = choose_target(args)
        if target is None:
            return atlas.EXIT_OK
        projects, name = target
        notify_started(name)
        problem = build_map(projects, name)
    except (RuntimeError, OSError) as error:
        problem = str(error)
    if problem:
        show_error(problem)
        return atlas.EXIT_ERROR
    return atlas.EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
