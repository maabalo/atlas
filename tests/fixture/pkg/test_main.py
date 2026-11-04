"""unittest-style tests: their methods are entry points, never "unused"."""

import unittest

from pkg.main import Greeter


class GreeterTest(unittest.TestCase):
    def helper_check(self):
        return Greeter("x")
