"""Fixture entry point."""

from pkg import helpers
from pkg.helpers import default_printer as printer
from pkg.helpers import logged


class Greeter:
    """Uses self.method calls."""

    def __init__(self, name):
        self.name = name

    def greet(self, out=printer):
        """Calls a sibling method through self."""
        out(self.format())

    def format(self):
        return helpers.tidy(self.name)


@logged
def run():
    Greeter("  Ada ").greet()


def main():
    run()
