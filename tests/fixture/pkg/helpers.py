"""Helpers for the fixture app (each is used in a different way)."""


def tidy(text):
    """Called through the module name: helpers.tidy()."""
    return text.strip()


def default_printer(message):
    """Only used as a default argument value."""
    print(message)


def logged(func):
    """Only used as a decorator."""
    return func


def orphan():
    """Nothing uses this one."""
    return 42
