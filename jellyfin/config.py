"""Where the Jellyfin server is, and how to prove we are allowed to ask it.

Configuration is read from the environment first and a JSON file second. The
environment wins because a key in a file has a way of ending up in a commit,
and because the server this runs on has no keyring to offer instead.

The file is created with owner-only permissions and is listed in .gitignore.
Neither of those makes a plaintext key safe, and it is worth being honest about
that: on a machine with no OS keyring, the file's permissions are the only thing
protecting it.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).with_name("config.json")

#: Read from the environment in preference to the file.
ENV_URL = "JELLYFIN_URL"
ENV_KEY = "JELLYFIN_API_KEY"
ENV_USER = "JELLYFIN_USER_ID"


class ConfigError(RuntimeError):
    """Configuration is missing or unusable."""


@dataclass(frozen=True)
class Config:
    """Everything needed to talk to one Jellyfin server.

    Attributes:
        url: Base URL with no trailing slash, e.g. ``http://100.123.135.10:8096``.
        api_key: An API key from Dashboard, Advanced, API Keys.
        user_id: The user whose libraries and watch state we read. Optional —
            :meth:`JellyfinClient.resolve_user_id` will find one if it is blank,
            which is convenient but ambiguous on a server with several users.
    """

    url: str
    api_key: str
    user_id: str = ""

    def __post_init__(self) -> None:
        if not self.url:
            raise ConfigError("No Jellyfin URL. Set JELLYFIN_URL or put 'url' in config.json.")
        if not self.api_key:
            raise ConfigError("No API key. Set JELLYFIN_API_KEY or put 'api_key' in config.json.")

    def redacted(self) -> str:
        """A description safe to print or log, with the key reduced to its shape."""
        shown = f"{self.api_key[:4]}...{len(self.api_key)} chars" if self.api_key else "(none)"
        return f"{self.url} as user {self.user_id or '(unresolved)'}, key {shown}"


def _from_file(path: Path) -> dict:
    """Read the JSON config, returning an empty mapping if there is not one.

    A malformed file is an error worth stopping for rather than working around:
    silently falling back to no configuration produces a confusing 401 later
    instead of a clear message here.
    """
    if not path.exists():
        return {}
    try:
        with path.open(encoding="utf-8") as handle:
            loaded = json.load(handle)
    except json.JSONDecodeError as error:
        raise ConfigError(f"{path} is not valid JSON: {error}") from error
    if not isinstance(loaded, dict):
        raise ConfigError(f"{path} should contain a JSON object, not {type(loaded).__name__}.")
    return loaded


def _haru_config_path() -> Path:
    """Where Haru herself keeps her settings, per platform."""
    if os.name == "nt":
        return Path(os.environ.get("APPDATA", "")) / "haru-desktop" / "config.json"
    return Path.home() / ".config" / "haru-desktop" / "config.json"


def _from_haru() -> dict:
    """Borrow the server address and key already entered in Haru's settings.

    One key, entered once. Two copies of a credential means two things to
    rotate, and one of them always gets forgotten.

    Only readable where she stored it unencrypted, which is any machine without
    an OS keyring — the headless server, in practice. On Windows safeStorage
    encrypts it against a key in her own Local State, so this finds nothing and
    quietly falls back to the environment or the file, which is correct: this
    should not be the thing that teaches a plaintext key to exist.
    """
    path = _haru_config_path()
    if not path.exists():
        return {}
    try:
        with path.open(encoding="utf-8") as handle:
            saved = json.load(handle)
    except (json.JSONDecodeError, OSError) as error:
        log.debug("could not read Haru's config at %s: %s", path, error)
        return {}

    jellyfin = saved.get("jellyfin") or {}
    key = saved.get("jellyfinApiKey") or ""
    if isinstance(key, str) and key.startswith("plain:"):
        key = key[len("plain:"):]
    elif key:
        log.debug("Haru's Jellyfin key is encrypted on this machine; not readable from here")
        key = ""

    found = {
        "url": (jellyfin.get("url") or "").strip().rstrip("/"),
        "api_key": key.strip(),
        "user_id": (jellyfin.get("userId") or "").strip(),
    }
    if found["url"] or found["api_key"]:
        log.debug("took %s from Haru's settings",
                  ", ".join(name for name, value in found.items() if value and name != "api_key") or "the key")
    return found


def load(path: Path | None = None) -> Config:
    """Assemble configuration from the environment, the config file, and Haru.

    Sources are tried in that order, so the most explicit wins:

    1. ``JELLYFIN_URL`` / ``JELLYFIN_API_KEY`` / ``JELLYFIN_USER_ID``
    2. ``jellyfin/config.json`` beside this module
    3. Whatever was entered in Haru's own settings, where it is readable

    Args:
        path: Where to look for config.json. Defaults to next to this module.

    Returns:
        A validated :class:`Config`.

    Raises:
        ConfigError: If the URL or API key cannot be found anywhere, or the
            file exists but cannot be parsed.
    """
    path = path or CONFIG_PATH
    saved = _from_file(path)
    hers = _from_haru()

    def pick(env_name: str, key: str) -> str:
        return (os.environ.get(env_name) or saved.get(key, "") or hers.get(key, "")).strip()

    config = Config(
        url=pick(ENV_URL, "url").rstrip("/"),
        api_key=pick(ENV_KEY, "api_key"),
        user_id=pick(ENV_USER, "user_id"),
    )
    log.debug("configured for %s", config.redacted())
    return config


def write_example(path: Path | None = None) -> Path:
    """Write a config.json template with owner-only permissions.

    Returns:
        The path written.
    """
    path = path or CONFIG_PATH
    path.write_text(
        json.dumps({"url": "http://100.123.135.10:8096", "api_key": "", "user_id": ""}, indent=2) + "\n",
        encoding="utf-8",
    )
    try:
        path.chmod(0o600)
    except OSError:  # Windows, or a filesystem without permission bits.
        log.debug("could not chmod %s; on this filesystem that is expected", path)
    return path
