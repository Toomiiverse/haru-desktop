"""Exercises the client against a stub server, so the paths that only appear
when something goes wrong are actually run.

The happy path tends to get tested by using the thing. Rate limiting, a revoked
key and a server that is switched off do not, and those are exactly the ones
that matter at two in the morning.

    python -m jellyfin.test_client
"""

from __future__ import annotations

import sys
from typing import Any

import requests

from .client import AuthError, JellyfinClient, JellyfinError, NotFound, Unreachable, describe, summarise
from .config import Config, ConfigError

PASSED = 0
FAILED = 0


def check(condition: bool, description: str, detail: str = "") -> None:
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  ok   {description}")
    else:
        FAILED += 1
        print(f"  FAIL {description}{f' — {detail}' if detail else ''}")


class FakeResponse:
    """Just enough of requests.Response for the client to work with."""

    def __init__(self, status: int = 200, payload: Any = None, headers: dict | None = None, text: str = "") -> None:
        self.status_code = status
        self._payload = payload
        self.headers = headers or {}
        self.text = text or ("" if payload is None else "body")
        self.content = b"" if payload is None and not text else b"body"

    @property
    def ok(self) -> bool:
        return self.status_code < 400

    def json(self) -> Any:
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class FakeSession:
    """Answers with a scripted sequence, and records what it was asked."""

    def __init__(self, script: list[Any]) -> None:
        self.script = list(script)
        self.calls: list[tuple[str, dict]] = []
        self.headers: dict[str, str] = {}

    def get(self, url: str, params: dict | None = None, timeout: Any = None) -> FakeResponse:
        self.calls.append((url, params or {}))
        if not self.script:
            raise AssertionError(f"unexpected extra request to {url}")
        answer = self.script.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def client_for(script: list[Any], user_id: str = "user-1") -> tuple[JellyfinClient, FakeSession]:
    session = FakeSession(script)
    config = Config(url="http://jellyfin.test:8096", api_key="key-abcdef123456", user_id=user_id)
    return JellyfinClient(config=config, session=session), session


def main() -> int:
    print("  configuration")
    try:
        Config(url="", api_key="k")
        check(False, "an empty URL is refused")
    except ConfigError:
        check(True, "an empty URL is refused")
    try:
        Config(url="http://x", api_key="")
        check(False, "a missing key is refused")
    except ConfigError:
        check(True, "a missing key is refused")
    redacted = Config(url="http://x", api_key="supersecretkey").redacted()
    check("supersecretkey" not in redacted, "the key is not in the description", redacted)

    print("\n  the key travels in a header, not a query string")
    client, session = client_for([FakeResponse(200, {"Items": []})])
    client.get_libraries()
    check("Authorization" in session.headers and "key-abcdef123456" in session.headers["Authorization"],
          "authorization header is set")
    check(all("api_key" not in params for _, params in session.calls),
          "no api_key in any query string")

    print("\n  browsing")
    client, session = client_for([FakeResponse(200, {"Items": [
        {"Id": "1", "Name": "Anime", "CollectionType": "tvshows"},
        {"Id": "2", "Name": "Films", "CollectionType": "movies"},
    ]})])
    libraries = client.get_libraries()
    check(len(libraries) == 2 and libraries[0]["Name"] == "Anime", "libraries come back")
    check(session.calls[0][0].endswith("/UserViews"), "using the 10.10+ route", session.calls[0][0])

    print("\n  searching")
    client, _ = client_for([FakeResponse(200, {"Items": [{"Id": "9", "Name": "Bleach", "Type": "Series"}]})])
    check(len(client.search_media("bleach")) == 1, "a search returns matches")
    client, _ = client_for([])
    try:
        client.search_media("   ")
        check(False, "an empty search is refused before it is sent")
    except ValueError:
        check(True, "an empty search is refused before it is sent")

    print("\n  an exact title beats a longer one")
    client, _ = client_for([FakeResponse(200, {"Items": [
        {"Id": "a", "Name": "Bleach: Thousand-Year Blood War", "Type": "Series"},
        {"Id": "b", "Name": "Bleach", "Type": "Series"},
    ]})])
    check(client.find_show("Bleach")["Id"] == "b", "exact match wins over the partial one")

    print("\n  episodes")
    episodes = {"Items": [
        {"Id": "e1", "Name": "One", "ParentIndexNumber": 1, "IndexNumber": 1, "SeriesName": "Bleach"},
        {"Id": "e3", "Name": "Three", "ParentIndexNumber": 1, "IndexNumber": 3, "SeriesName": "Bleach"},
    ]}
    series = {"Items": [{"Id": "s1", "Name": "Bleach", "Type": "Series"}]}
    client, _ = client_for([FakeResponse(200, series), FakeResponse(200, episodes)])
    check(client.find_episode("Bleach", 1, 3)["Id"] == "e3", "the right episode is found")
    client, _ = client_for([FakeResponse(200, series), FakeResponse(200, episodes)])
    try:
        client.find_episode("Bleach", 1, 99)
        check(False, "a missing episode says so")
    except NotFound:
        check(True, "a missing episode says so")

    print("\n  playback")
    client, _ = client_for([])
    url = client.get_playback_url("abc 123")
    check("/Videos/abc%20123/stream" in url, "the id is escaped into the path", url)
    check("static=true" in url and "api_key=key-abcdef123456" in url, "it is a direct-play URL with the key")

    print("\n  when things go wrong")
    client, _ = client_for([FakeResponse(401)])
    try:
        client.get_libraries()
        check(False, "a rejected key is named as such")
    except AuthError:
        check(True, "a rejected key is named as such")

    client, _ = client_for([requests.exceptions.ConnectionError("refused")])
    try:
        client.get_libraries()
        check(False, "an unreachable server is named as such")
    except Unreachable as error:
        check("Tailscale" in str(error), "an unreachable server suggests the likely cause", str(error))

    # Rate limited twice, then fine. Retry-After is honoured but zeroed here so
    # the test does not actually sleep for two seconds.
    client, session = client_for([
        FakeResponse(429, headers={"Retry-After": "0"}),
        FakeResponse(429, headers={"Retry-After": "0"}),
        FakeResponse(200, {"Items": [{"Id": "1", "Name": "Anime"}]}),
    ])
    check(len(client.get_libraries()) == 1, "rate limiting is retried through")
    check(len(session.calls) == 3, "and it took exactly three attempts", str(len(session.calls)))

    client, _ = client_for([FakeResponse(500, headers={"Retry-After": "0"})] * 3)
    try:
        client.get_libraries()
        check(False, "a server failing every time eventually gives up")
    except Unreachable:
        check(True, "a server failing every time eventually gives up")

    client, _ = client_for([FakeResponse(404)])
    try:
        client.get_libraries()
        check(False, "a 404 is not retried")
    except NotFound:
        check(True, "a 404 is not retried")

    print("\n  resolving a user when none is configured")
    client, _ = client_for([
        FakeResponse(200, [{"Id": "u9", "Name": "tommy"}]),
        FakeResponse(200, {"Items": []}),
    ], user_id="")
    client.get_libraries()
    check(client.resolve_user_id() == "u9", "a user is looked up and remembered")

    print("\n  readable output")
    line = describe({"Type": "Episode", "SeriesName": "Bleach", "ParentIndexNumber": 1,
                     "IndexNumber": 3, "Name": "Three"})
    check(line == "Bleach S01E03 — Three", "an episode reads sensibly", line)
    film = describe({"Type": "Movie", "Name": "Akira", "ProductionYear": 1988})
    check(film == "Akira (1988) [Movie]", "a film reads sensibly", film)
    check(summarise([]) == "  nothing", "an empty list says so")

    print(f"\n  {PASSED}/{PASSED + FAILED}")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
