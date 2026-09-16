"""Preserve source SPICE real division in converted native expressions.

VACASK deliberately has integer division. Adding a unit real multiplier at the
same precedence/associativity as / promotes its left operand before division,
including a compound numerator. It does not wrap the already truncated result.
This only processes parameter expressions supplied by the source parser, never
arbitrary native user code or complete decks.
"""
import re

_token = re.compile(r'"(?:\\.|[^"\\])*"|/(?![/*])')
_promoted = re.compile(r'\*\s*1\.0\s*$')


def real_source_division(expression):
    def lower(match):
        if match.group() != '/':
            return match.group()
        # Formatting/collection can visit an expression twice. A generated
        # promotion is already sufficient; don't grow the source on each pass.
        if _promoted.search(expression[:match.start()]):
            return '/'
        return '*1.0/'
    return _token.sub(lower, expression)
