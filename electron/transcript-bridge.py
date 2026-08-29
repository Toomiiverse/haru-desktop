#!/usr/bin/env python3
"""The one thing this does: hand back the words spoken in a YouTube video.

Run by transcripts.ts, one video per invocation, JSON on stdout. It exists
because YouTube shut the direct caption endpoint and the player API to plain
requests in 2026, and youtube-transcript-api is the maintained library that
tracks exactly that churn — the churn this project should not be tracking by
hand. Kept to a single file with no arguments beyond the id, so that what it
can do is easy to read off.
"""
import json
import sys


def main() -> int:
    video_id = sys.argv[1] if len(sys.argv) > 1 else ''
    if not video_id:
        print(json.dumps({'error': 'no video id'}))
        return 2
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        print(json.dumps({'error': 'youtube-transcript-api is not installed'}))
        return 3
    try:
        api = YouTubeTranscriptApi()
        tracks = api.list(video_id)
        try:
            track = tracks.find_transcript(['en', 'en-US', 'en-GB'])
        except Exception:
            track = next(iter(tracks))
        fetched = track.fetch()
        captions = [{'atSeconds': round(float(s.start)), 'text': s.text} for s in fetched if str(s.text).strip()]
        print(json.dumps({
            'language': track.language_code,
            'generated': bool(track.is_generated),
            'captions': captions,
        }, ensure_ascii=False))
        return 0
    except Exception as error:  # noqa: BLE001 — the reason is the payload
        print(json.dumps({'error': f'{type(error).__name__}: {error}'[:300]}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
