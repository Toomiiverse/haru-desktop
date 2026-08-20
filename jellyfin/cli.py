"""Command line for the Jellyfin client, for trying things by hand.

    python -m jellyfin list-libraries
    python -m jellyfin search "cowboy bebop"
    python -m jellyfin show "Bleach"
    python -m jellyfin play "Bleach" 1 3
    python -m jellyfin recent
    python -m jellyfin next

Failures are reported as one sentence and a non-zero exit code. The stack trace
is there under --debug when it is actually wanted, but a traceback is a poor way
to tell someone their server is switched off.
"""

from __future__ import annotations

import argparse
import logging
import sys

from .client import JellyfinClient, JellyfinError, describe, summarise
from .config import ConfigError, write_example

log = logging.getLogger("jellyfin")


def build_parser() -> argparse.ArgumentParser:
    """The argument parser, as its own function so tests can inspect it."""
    parser = argparse.ArgumentParser(
        prog="python -m jellyfin",
        description="Browse and search a Jellyfin server.",
    )
    parser.add_argument("--debug", action="store_true", help="log every request, and show tracebacks")
    parser.add_argument("--limit", type=int, default=20, help="most results to show (default: 20)")

    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list-libraries", help="every library on the server")

    search = commands.add_parser("search", help="search for a film, series or episode")
    search.add_argument("query", help="what to look for")

    show = commands.add_parser("show", help="every episode of a series")
    show.add_argument("name", help="all or part of the series title")

    play = commands.add_parser("play", help="a streaming URL for one episode")
    play.add_argument("name", help="all or part of the series title")
    play.add_argument("season", type=int, help="season number (0 for specials)")
    play.add_argument("episode", type=int, help="episode number within that season")

    commands.add_parser("recent", help="what arrived on the server lately")
    commands.add_parser("next", help="the next unwatched episode of each series started")
    commands.add_parser("init", help="write a config.json template to fill in")
    return parser


def run(arguments: argparse.Namespace) -> int:
    """Carry out one command.

    Returns:
        A process exit code: 0 for success, 1 for anything the user should read.
    """
    if arguments.command == "init":
        path = write_example()
        print(f"  wrote {path}")
        print("  Fill in api_key, and user_id if the server has more than one user.")
        print("  JELLYFIN_API_KEY in the environment overrides the file, and leaves nothing on disk.")
        return 0

    client = JellyfinClient()
    log.debug("connected to %s", client.config.redacted())

    if arguments.command == "list-libraries":
        libraries = client.get_libraries()
        print(f"  {client.server_name()} has {len(libraries)} librar{'y' if len(libraries) == 1 else 'ies'}:")
        for library in libraries:
            print(f"    {library.get('Name', '?'):<24} {library.get('CollectionType', 'mixed')}")
        return 0

    if arguments.command == "search":
        found = client.search_media(arguments.query, limit=arguments.limit)
        print(f"  {len(found)} match(es) for {arguments.query!r}:")
        print(summarise(found, "  nothing matched"))
        return 0 if found else 1

    if arguments.command == "show":
        episodes = client.get_show_episodes(arguments.name)
        seasons = sorted({episode.get("ParentIndexNumber") for episode in episodes if episode.get("ParentIndexNumber") is not None})
        print(f"  {len(episodes)} episode(s) across season(s) {', '.join(str(season) for season in seasons) or '?'}:")
        print(summarise(episodes[: arguments.limit]))
        if len(episodes) > arguments.limit:
            print(f"  ... and {len(episodes) - arguments.limit} more (raise --limit to see them)")
        return 0

    if arguments.command == "play":
        episode = client.find_episode(arguments.name, arguments.season, arguments.episode)
        print(f"  {describe(episode)}")
        # Printed, never logged: this URL carries the API key.
        print(f"  {client.get_playback_url(episode['Id'])}")
        print("  That URL contains your API key. Treat it as a password.")
        return 0

    if arguments.command == "recent":
        found = client.get_recently_added(limit=arguments.limit)
        print(f"  {len(found)} recently added:")
        print(summarise(found, "  nothing added lately"))
        return 0

    if arguments.command == "next":
        found = client.get_next_episodes(limit=arguments.limit)
        print(f"  {len(found)} series to carry on with:")
        print(summarise(found, "  nothing started, or everything is watched"))
        return 0

    raise AssertionError(f"unhandled command {arguments.command!r}")


def main(argv: list[str] | None = None) -> int:
    """Entry point. Returns a process exit code rather than calling sys.exit."""
    arguments = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if arguments.debug else logging.WARNING,
        format="  %(levelname)s %(name)s: %(message)s",
    )
    try:
        return run(arguments)
    except (ConfigError, JellyfinError, ValueError) as error:
        # Expected failures: say what happened, in one line.
        if arguments.debug:
            log.exception("failed")
        print(f"  {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("  stopped", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
