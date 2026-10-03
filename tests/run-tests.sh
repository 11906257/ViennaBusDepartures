#!/bin/sh
set -eu

node --test tests/*.test.mjs
PYTHONPYCACHEPREFIX="${TMPDIR:-/tmp}/vienna-bus-pycache" \
  python3 -m unittest discover -s tests -p 'test_*.py'
