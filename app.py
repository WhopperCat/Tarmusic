"""Tarmusic — a Flask web app wrapping ytmusicapi for browsing and playing YouTube Music."""
from __future__ import annotations

import re
import time
from functools import lru_cache
from threading import Lock
from typing import Any

import requests
import syncedlyrics
import yt_dlp
from flask import Flask, Response, jsonify, render_template, request, stream_with_context
from ytmusicapi import YTMusic

app = Flask(__name__)


@lru_cache(maxsize=1)
def yt() -> YTMusic:
    return YTMusic()


def err(message: str, status: int = 500) -> tuple[Any, int]:
    return jsonify({"error": message}), status


# --- audio URL resolution via yt-dlp -----------------------------------------

_STREAM_TTL_SECONDS = 5 * 60
_stream_cache: dict[str, tuple[float, str, str]] = {}
_stream_cache_lock = Lock()

_YDL_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "format": "bestaudio[ext=m4a]/bestaudio/best",
    "noplaylist": True,
}


def resolve_audio(video_id: str) -> tuple[str, str]:
    now = time.time()
    with _stream_cache_lock:
        cached = _stream_cache.get(video_id)
        if cached and cached[0] > now:
            return cached[1], cached[2]

    with yt_dlp.YoutubeDL(_YDL_OPTS) as ydl:
        info = ydl.extract_info(
            f"https://www.youtube.com/watch?v={video_id}", download=False
        )

    url = info.get("url")
    if not url and "requested_formats" in info:
        url = info["requested_formats"][0]["url"]
    if not url:
        raise RuntimeError("no audio stream URL returned by yt-dlp")

    content_type = info.get("http_headers", {}).get("Content-Type") or "audio/mp4"

    with _stream_cache_lock:
        _stream_cache[video_id] = (now + _STREAM_TTL_SECONDS, url, content_type)
    return url, content_type


# --- routes ------------------------------------------------------------------


@app.route("/")
def index() -> str:
    return render_template("index.html")


@app.route("/api/search")
def api_search():
    query = (request.args.get("q") or "").strip()
    filter_ = request.args.get("filter") or None
    if not query:
        return err("missing query parameter 'q'", 400)
    try:
        results = yt().search(query, filter=filter_, limit=25)
    except Exception as exc:
        return err(str(exc))
    return jsonify({"results": results})


@app.route("/api/song/<video_id>")
def api_song(video_id: str):
    try:
        song = yt().get_song(video_id)
    except Exception as exc:
        return err(str(exc))
    return jsonify(song)


@app.route("/api/artist/<channel_id>")
def api_artist(channel_id: str):
    try:
        artist = yt().get_artist(channel_id)
    except Exception as exc:
        return err(str(exc))
    return jsonify(artist)


@app.route("/api/album/<browse_id>")
def api_album(browse_id: str):
    try:
        album = yt().get_album(browse_id)
    except Exception as exc:
        return err(str(exc))
    return jsonify(album)


@app.route("/api/playlist/<playlist_id>")
def api_playlist(playlist_id: str):
    try:
        playlist = yt().get_playlist(playlist_id, limit=100)
    except Exception as exc:
        return err(str(exc))
    return jsonify(playlist)


@app.route("/api/watch/<video_id>")
def api_watch(video_id: str):
    try:
        watch = yt().get_watch_playlist(videoId=video_id, limit=25)
    except Exception as exc:
        return err(str(exc))
    return jsonify(watch)


# --- lyrics ------------------------------------------------------------------

_LRC_TIMESTAMP = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
_LRC_WORD = re.compile(r"<(\d+):(\d+(?:\.\d+)?)>")

_lyrics_cache: dict[str, tuple[float, dict]] = {}
_LYRICS_TTL = 6 * 60 * 60


def _parse_ts(minutes: str, seconds: str) -> float:
    return int(minutes) * 60 + float(seconds)


def parse_lrc(text: str) -> dict:
    """Parse plain, line-synced, or enhanced (word-level) LRC into structured form."""
    if not text:
        return {"format": "plain", "lines": [], "plain": ""}

    raw_lines = [ln for ln in text.splitlines() if ln.strip()]
    parsed_lines: list[dict] = []
    has_word_timing = False
    has_line_timing = False

    for ln in raw_lines:
        line_starts: list[float] = []
        body = ln
        while True:
            m = _LRC_TIMESTAMP.match(body)
            if not m:
                break
            line_starts.append(_parse_ts(m.group(1), m.group(2)))
            body = body[m.end():]

        if not line_starts:
            # metadata-only or untimed line
            if ln.startswith("[") and "]" in ln:
                continue
            parsed_lines.append({"time": None, "words": [{"time": None, "text": ln}]})
            continue

        has_line_timing = True
        word_matches = list(_LRC_WORD.finditer(body))
        if word_matches:
            has_word_timing = True
            words = []
            # leading text before the first <ts> belongs to the line-start time
            first_pos = word_matches[0].start()
            head = body[:first_pos]
            if head:
                words.append({"time": line_starts[0], "text": head})
            for i, m in enumerate(word_matches):
                w_time = _parse_ts(m.group(1), m.group(2))
                end_pos = (
                    word_matches[i + 1].start()
                    if i + 1 < len(word_matches)
                    else len(body)
                )
                segment = body[m.end():end_pos]
                if segment:
                    words.append({"time": w_time, "text": segment})
            for start in line_starts:
                parsed_lines.append({"time": start, "words": words})
        else:
            for start in line_starts:
                parsed_lines.append(
                    {"time": start, "words": [{"time": start, "text": body}]}
                )

    parsed_lines.sort(key=lambda x: (x["time"] is None, x["time"] or 0))

    fmt = "word" if has_word_timing else ("line" if has_line_timing else "plain")
    plain = "\n".join("".join(w["text"] for w in ln["words"]) for ln in parsed_lines)
    return {"format": fmt, "lines": parsed_lines, "plain": plain}


def _song_title_artist(video_id: str) -> tuple[str, str]:
    try:
        song = yt().get_song(video_id)
        vd = song.get("videoDetails", {}) or {}
        title = vd.get("title") or ""
        author = vd.get("author") or ""
        return title, author
    except Exception:
        return "", ""


def fetch_lyrics(video_id: str) -> dict:
    now = time.time()
    cached = _lyrics_cache.get(video_id)
    if cached and cached[0] > now:
        return cached[1]

    title, artist = _song_title_artist(video_id)
    # Strip noisy suffixes that hurt match rates ("- Topic", "(Official Video)", etc.)
    clean_artist = re.sub(r"\s*-?\s*Topic\s*$", "", artist, flags=re.I).strip()
    clean_title = re.sub(
        r"\s*[\(\[].*?(official|video|audio|lyric|remaster|hd|mv).*?[\)\]]\s*",
        "",
        title,
        flags=re.I,
    ).strip()

    search_term = f"{clean_title} {clean_artist}".strip()
    result = {
        "format": "plain",
        "lines": [],
        "plain": "",
        "source": None,
        "title": title,
        "artist": artist,
    }

    if not search_term:
        _lyrics_cache[video_id] = (now + _LYRICS_TTL, result)
        return result

    enhanced_providers = ["Musixmatch", "NetEase"]
    line_providers = ["Lrclib", "Musixmatch", "NetEase", "Megalobiz"]

    lrc = None
    try:
        lrc = syncedlyrics.search(
            search_term, enhanced=True, providers=enhanced_providers
        )
    except Exception:
        lrc = None

    if not lrc or "<" not in (lrc or ""):
        try:
            line_lrc = syncedlyrics.search(search_term, providers=line_providers)
            if line_lrc:
                lrc = line_lrc
        except Exception:
            pass

    if lrc:
        parsed = parse_lrc(lrc)
        result.update(parsed)
        result["source"] = "syncedlyrics"

    _lyrics_cache[video_id] = (now + _LYRICS_TTL, result)
    return result


@app.route("/api/lyrics/<video_id>")
def api_lyrics(video_id: str):
    try:
        data = fetch_lyrics(video_id)
    except Exception as exc:
        return err(str(exc))
    return jsonify(data)


@app.route("/api/charts")
def api_charts():
    country = request.args.get("country", "ZZ")
    try:
        charts = yt().get_charts(country=country)
    except Exception as exc:
        return err(str(exc))
    return jsonify(charts)


@app.route("/api/stream/<video_id>")
def api_stream(video_id: str):
    try:
        url, content_type = resolve_audio(video_id)
    except Exception as exc:
        return err(f"could not resolve audio: {exc}")

    upstream_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    }
    if "Range" in request.headers:
        upstream_headers["Range"] = request.headers["Range"]

    upstream = requests.get(url, headers=upstream_headers, stream=True, timeout=30)

    def generate():
        try:
            for chunk in upstream.iter_content(chunk_size=64 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    resp = Response(
        stream_with_context(generate()),
        status=upstream.status_code,
        content_type=content_type,
    )
    for header in ("Content-Length", "Content-Range", "Accept-Ranges"):
        if header in upstream.headers:
            resp.headers[header] = upstream.headers[header]
    resp.headers.setdefault("Accept-Ranges", "bytes")
    return resp


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
