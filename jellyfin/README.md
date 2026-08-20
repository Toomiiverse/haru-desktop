# Jellyfin client

Browse, search and play from the Jellyfin server at `100.123.135.10:8096`
(`Haru_Anime`, currently 10.11.11).

## Setting it up

```bash
pip install -r jellyfin/requirements.txt
python -m jellyfin init          # writes config.json, chmod 600
```

Then put an API key in it — Jellyfin Dashboard → Advanced → API Keys.

Better still, paste it into **Haru's own setup page** instead — there is a
"Her media server" section. This client reads the same value, so there is one
key to rotate rather than two. (Readable only where she stores it unencrypted,
which means the headless server; on Windows safeStorage encrypts it and this
falls back to the environment or the file, which is the right way round.)

Or keep it out of the filesystem entirely:

```bash
export JELLYFIN_API_KEY="..."    # the environment beats the file
```

Sources are tried in order: the environment, then `jellyfin/config.json`, then
Haru's settings. The most explicit wins.

`user_id` can be left blank on a single-user server; the client looks one up
and says which it chose. On a server with several users, set it.

## Using it

```bash
python -m jellyfin list-libraries
python -m jellyfin search "cowboy bebop"
python -m jellyfin show "Bleach"
python -m jellyfin play "Bleach" 1 3
python -m jellyfin recent
python -m jellyfin next
```

`--debug` logs every request. `--limit N` caps results.

## From Python

```python
from jellyfin import JellyfinClient

client = JellyfinClient()
for episode in client.get_next_episodes():
    print(episode["SeriesName"], episode["IndexNumber"])
```

## Two things worth knowing

`get_playback_url()` embeds the API key in the query string, because that is
how Jellyfin authenticates a player that cannot set headers. Treat the result
as a credential: it is never logged, and it should not be pasted anywhere the
URL might be recorded. Every other call sends the key in an `Authorization`
header instead.

`config.json` is gitignored and written `chmod 600`, but a key in a file on a
box with no keyring is only as private as its permissions. The environment
variable leaves nothing on disk at all.

## Tests

```bash
python -m jellyfin.test_client
```

Runs against a stub server, so the paths that only appear when something breaks
— rate limiting, a revoked key, a server that is switched off — are actually
exercised rather than assumed.
