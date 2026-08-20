"""Lets the package be run directly: python -m jellyfin ..."""

import sys

from .cli import main

sys.exit(main())
