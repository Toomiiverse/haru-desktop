"""Jellyfin client for Haru: browse, search, and find something to play."""

from .client import (
    AuthError,
    JellyfinClient,
    JellyfinError,
    NotFound,
    Unreachable,
    describe,
    summarise,
)
from .config import Config, ConfigError, load

__all__ = [
    "AuthError",
    "Config",
    "ConfigError",
    "JellyfinClient",
    "JellyfinError",
    "NotFound",
    "Unreachable",
    "describe",
    "load",
    "summarise",
]
