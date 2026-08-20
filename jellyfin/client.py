"""A small Jellyfin client: browse, search, and find something to play.

Written against Jellyfin 10.11. That version matters — 10.10 deprecated the
user-scoped item routes (``/Users/{id}/Items``) in favour of passing ``userId``
as a query parameter, and the old ones will eventually go. Everything here uses
the current form.

Every network call goes through :meth:`JellyfinClient._get`, which is the only
place that knows about timeouts, retries and error shapes. That is deliberate:
six functions each with their own idea of what a failure looks like is how a
library ends up throwing three different exceptions for one unplugged cable.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Iterable, Sequence
from urllib.parse import quote, urlencode

import requests

from .config import Config, load

log = logging.getLogger(__name__)

#: Long enough for a library scan to answer, short enough to not hang a bot.
CONNECT_TIMEOUT = 5.0
READ_TIMEOUT = 30.0

#: Retried, with a pause between attempts. Anything else is reported at once —
#: a 401 will not become a 200 by asking again.
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 1.5

#: What Jellyfin shows in its dashboard for this connection.
CLIENT_NAME = "Haru"
CLIENT_VERSION = "1.0.0"


class JellyfinError(RuntimeError):
    """Anything that went wrong talking to Jellyfin."""


class Unreachable(JellyfinError):
    """The server could not be reached at all: DNS, refused, or timed out."""


class AuthError(JellyfinError):
    """The server answered, and said no. Usually a bad or revoked API key."""


class NotFound(JellyfinError):
    """The server answered, and had nothing matching."""


class JellyfinClient:
    """Talks to one Jellyfin server on behalf of one user.

    Args:
        config: Where the server is and how to authenticate. Loaded from the
            environment and config.json when omitted.
        session: An existing :class:`requests.Session`, mostly for tests.

    Example:
        >>> client = JellyfinClient()
        >>> for library in client.get_libraries():
        ...     print(library["Name"])
    """

    def __init__(self, config: Config | None = None, session: requests.Session | None = None) -> None:
        self.config = config or load()
        self.session = session or requests.Session()
        # The documented header for Jellyfin 10.x. The bare X-Emby-Token still
        # works, but this one also names the connection in the dashboard, which
        # makes an abandoned key easy to spot and revoke.
        self.session.headers.update({
            "Authorization": (
                f'MediaBrowser Client="{CLIENT_NAME}", Device="{CLIENT_NAME}", '
                f'DeviceId="{CLIENT_NAME.lower()}-cli", Version="{CLIENT_VERSION}", '
                f'Token="{self.config.api_key}"'
            ),
            "Accept": "application/json",
        })
        self._user_id = self.config.user_id

    # ---- the one place that talks to the network --------------------------

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        """GET a path under the server root and return the decoded JSON.

        Retries on rate limiting and on the server's own transient failures,
        honouring ``Retry-After`` when it is given. A 401, 403 or 404 is
        returned to the caller immediately, because repeating them is pointless.

        Args:
            path: Path beginning with a slash, e.g. ``/UserViews``.
            params: Query parameters. ``None`` values are dropped.

        Returns:
            The decoded response body, or ``None`` for an empty one.

        Raises:
            Unreachable: The server could not be reached, or kept failing.
            AuthError: The key was rejected.
            NotFound: The server had nothing at that path.
            JellyfinError: Any other unsuccessful response.
        """
        url = f"{self.config.url}{path}"
        clean = {key: value for key, value in (params or {}).items() if value is not None}
        last_error: Exception | None = None

        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                # The key lives in a header, so logging the URL is safe. That is
                # not true of the playback URL built below, which is why that one
                # is never logged.
                log.debug("GET %s %s (attempt %d)", path, clean or "", attempt)
                response = self.session.get(url, params=clean, timeout=(CONNECT_TIMEOUT, READ_TIMEOUT))
            except requests.exceptions.Timeout as error:
                last_error = error
                log.warning("timed out on %s (attempt %d of %d)", path, attempt, MAX_ATTEMPTS)
            except requests.exceptions.ConnectionError as error:
                # Nothing listening, or no route. Worth naming plainly: on this
                # setup it usually means the server is off or Tailscale is down.
                raise Unreachable(
                    f"Could not reach {self.config.url}. Is the server on, and is Tailscale up?"
                ) from error
            else:
                if response.status_code in (401, 403):
                    raise AuthError(
                        "Jellyfin rejected the API key. Check it in Dashboard, Advanced, API Keys."
                    )
                if response.status_code == 404:
                    raise NotFound(f"Jellyfin has nothing at {path}.")
                if response.status_code in RETRY_STATUSES:
                    last_error = JellyfinError(f"{response.status_code} from {path}")
                    wait = self._retry_after(response, attempt)
                    log.warning(
                        "%s from %s, waiting %.1fs (attempt %d of %d)",
                        response.status_code, path, wait, attempt, MAX_ATTEMPTS,
                    )
                    if attempt < MAX_ATTEMPTS:
                        time.sleep(wait)
                    continue
                if not response.ok:
                    raise JellyfinError(f"{response.status_code} from {path}: {response.text[:200]}")
                if not response.content:
                    return None
                try:
                    return response.json()
                except ValueError as error:
                    raise JellyfinError(f"{path} did not return JSON: {response.text[:200]}") from error

            if attempt < MAX_ATTEMPTS:
                time.sleep(BACKOFF_SECONDS * attempt)

        raise Unreachable(f"{path} failed {MAX_ATTEMPTS} times: {last_error}")

    @staticmethod
    def _retry_after(response: requests.Response, attempt: int) -> float:
        """How long to wait, preferring the server's own answer to our guess."""
        header = response.headers.get("Retry-After")
        if header:
            try:
                return max(0.0, float(header))
            except ValueError:
                pass  # Some servers send a date here; fall through to backoff.
        return BACKOFF_SECONDS * attempt

    # ---- who we are -------------------------------------------------------

    def resolve_user_id(self) -> str:
        """Return the configured user id, looking one up if none was set.

        Watch state — what is next up, what was recently added — belongs to a
        user, so almost everything here needs one.

        Returns:
            A Jellyfin user id.

        Raises:
            JellyfinError: If the server has no users, which should not happen.
        """
        if self._user_id:
            return self._user_id
        users = self._get("/Users") or []
        if not users:
            raise JellyfinError("This server reports no users, so there is no watch state to read.")
        self._user_id = users[0]["Id"]
        if len(users) > 1:
            names = ", ".join(user.get("Name", "?") for user in users)
            log.warning(
                "No user configured and this server has several (%s). Using %s. "
                "Set JELLYFIN_USER_ID to choose.", names, users[0].get("Name"),
            )
        return self._user_id

    def server_name(self) -> str:
        """The server's own name, and a cheap way to prove the key works."""
        info = self._get("/System/Info") or {}
        return info.get("ServerName", "(unnamed)")

    # ---- browsing ---------------------------------------------------------

    def get_libraries(self) -> list[dict]:
        """Every media library visible to this user.

        Returns:
            Library objects, each with at least ``Id``, ``Name`` and
            ``CollectionType`` (``movies``, ``tvshows``, ``music``...).
        """
        found = self._get("/UserViews", {"userId": self.resolve_user_id()}) or {}
        return found.get("Items", [])

    def search_media(self, query: str, limit: int = 25,
                     kinds: Sequence[str] = ("Movie", "Series", "Episode")) -> list[dict]:
        """Search the whole library for something.

        Args:
            query: What to look for. Jellyfin matches on substrings.
            limit: Most results to return.
            kinds: Item types to include.

        Returns:
            Matching items, each with ``Id``, ``Name``, ``Type`` and, for
            episodes, ``SeriesName`` and season and episode numbers.

        Raises:
            ValueError: If the query is empty, which would otherwise return the
                entire library and look like a hang.
        """
        if not query.strip():
            raise ValueError("Give something to search for.")
        found = self._get("/Items", {
            "userId": self.resolve_user_id(),
            "searchTerm": query.strip(),
            "IncludeItemTypes": ",".join(kinds),
            "Recursive": "true",
            "Limit": limit,
            "Fields": "Overview,ProductionYear",
        }) or {}
        items = found.get("Items", [])
        log.info("search %r matched %d item(s)", query, len(items))
        return items

    def find_show(self, show_name: str) -> dict:
        """The one series best matching a name.

        An exact case-insensitive match wins over a partial one, so "Bleach"
        does not return "Bleach: Thousand-Year Blood War" when both exist.

        Args:
            show_name: All or part of a series title.

        Returns:
            The matching series item.

        Raises:
            NotFound: If nothing matches.
        """
        candidates = self.search_media(show_name, kinds=("Series",))
        if not candidates:
            raise NotFound(f"No series matching {show_name!r}.")
        wanted = show_name.strip().casefold()
        for candidate in candidates:
            if candidate.get("Name", "").casefold() == wanted:
                return candidate
        if len(candidates) > 1:
            log.info("%r matched %d series; using %r",
                     show_name, len(candidates), candidates[0].get("Name"))
        return candidates[0]

    def get_show_episodes(self, show_name: str) -> list[dict]:
        """Every episode of a series, in order.

        Args:
            show_name: All or part of a series title.

        Returns:
            Episode items with ``ParentIndexNumber`` (season),
            ``IndexNumber`` (episode), ``Name`` and ``Id``. Specials sit in
            season 0, as Jellyfin files them.

        Raises:
            NotFound: If no such series exists.
        """
        series = self.find_show(show_name)
        found = self._get(f"/Shows/{series['Id']}/Episodes", {
            "userId": self.resolve_user_id(),
            "Fields": "Overview",
        }) or {}
        episodes = found.get("Items", [])
        log.info("%s has %d episode(s)", series.get("Name"), len(episodes))
        return episodes

    def find_episode(self, show_name: str, season: int, episode: int) -> dict:
        """One specific episode.

        Args:
            show_name: All or part of a series title.
            season: Season number. 0 is specials.
            episode: Episode number within that season.

        Returns:
            The episode item.

        Raises:
            NotFound: If the series exists but that episode does not.
        """
        for candidate in self.get_show_episodes(show_name):
            if candidate.get("ParentIndexNumber") == season and candidate.get("IndexNumber") == episode:
                return candidate
        raise NotFound(f"{show_name} has no season {season} episode {episode}.")

    # ---- playback ---------------------------------------------------------

    def get_playback_url(self, item_id: str) -> str:
        """A direct URL a player can open for this item.

        The API key is embedded in the query string, because that is how
        Jellyfin authenticates a bare player that cannot set headers. Treat the
        result as a credential: do not log it, paste it, or put it anywhere the
        URL might be recorded. It is deliberately never logged here.

        Args:
            item_id: The item's ``Id``.

        Returns:
            A URL that streams the file without transcoding where the client
            can handle it.
        """
        query = urlencode({"static": "true", "api_key": self.config.api_key})
        return f"{self.config.url}/Videos/{quote(item_id)}/stream?{query}"

    # ---- what to watch next -----------------------------------------------

    def get_recently_added(self, limit: int = 20) -> list[dict]:
        """What has arrived on the server lately.

        Args:
            limit: Most items to return.

        Returns:
            Recently added items, newest first.
        """
        items = self._get("/Items/Latest", {
            "userId": self.resolve_user_id(),
            "Limit": limit,
            "Fields": "ProductionYear",
        }) or []
        # This endpoint answers with a bare list rather than the usual envelope.
        return items if isinstance(items, list) else items.get("Items", [])

    def get_next_episodes(self, limit: int = 20) -> list[dict]:
        """The next unwatched episode of each series already started.

        Returns:
            Episode items, most recently watched series first. A series that has
            never been started does not appear, which is what makes this a list
            of what to carry on with rather than a list of everything.
        """
        found = self._get("/Shows/NextUp", {
            "userId": self.resolve_user_id(),
            "Limit": limit,
            "Fields": "Overview",
        }) or {}
        return found.get("Items", [])


def describe(item: dict) -> str:
    """One readable line for an item, whatever kind it is.

    Episodes get their series and numbering, because "Episode 3" on its own is
    no use in a list of twenty.
    """
    kind = item.get("Type", "?")
    name = item.get("Name", "(untitled)")
    if kind == "Episode":
        season = item.get("ParentIndexNumber")
        number = item.get("IndexNumber")
        code = f"S{season:02d}E{number:02d}" if season is not None and number is not None else "?"
        return f"{item.get('SeriesName', '?')} {code} — {name}"
    year = item.get("ProductionYear")
    return f"{name}{f' ({year})' if year else ''} [{kind}]"


def summarise(items: Iterable[dict], empty: str = "  nothing") -> str:
    """Several items as numbered lines, or a stated absence."""
    lines = [f"  {index:2d}. {describe(item)}" for index, item in enumerate(items, 1)]
    return "\n".join(lines) if lines else empty
