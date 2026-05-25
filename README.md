# Tarmusic

A self-hosted web music player built on [ytmusicapi](https://github.com/sigma67/ytmusicapi). Search YouTube Music, browse artists/albums/playlists/charts, stream audio, and follow along with Apple-Music-style synced lyrics.

## How it works

- **Metadata** comes from `ytmusicapi` (no auth needed for search/browse/charts).
- **Audio** is resolved via `yt-dlp` and proxied through Flask (so seeking works and the IP-bound URL stays server-side).
- **Lyrics** come from `syncedlyrics`, which queries Musixmatch / LRCLIB / NetEase / Megalobiz. When word-level (Enhanced LRC) is available the renderer highlights words in time with the audio; otherwise it falls back to line-level sync, which still scrolls smoothly Apple-Music-style.

## Run it

```bash
python3 -m pip install -r requirements.txt
python3 app.py
# open http://localhost:5000
```

## Routes

| Endpoint | Purpose |
| --- | --- |
| `GET /api/search?q=&filter=` | search songs/albums/artists/playlists |
| `GET /api/song/<videoId>` | song metadata |
| `GET /api/artist/<channelId>` | artist + top songs + discography |
| `GET /api/album/<browseId>` | album + tracklist |
| `GET /api/playlist/<playlistId>` | playlist + tracks |
| `GET /api/watch/<videoId>` | up-next / autoplay queue |
| `GET /api/charts?country=ZZ` | global / regional charts |
| `GET /api/lyrics/<videoId>` | structured `{format, lines:[{time,words:[{time,text}]}], source}` |
| `GET /api/stream/<videoId>` | audio stream (with HTTP Range support) |

## Caveats

- True per-word lyrics depend on the source. Most popular songs have line-level synced lyrics on LRCLIB/NetEase; word-level lyrics depend on Musixmatch Richsync being reachable. The renderer transparently uses whatever it gets.
- Audio URLs from `yt-dlp` expire and are IP-bound — that's why this proxies the stream rather than redirecting clients to it. Lyrics and audio URLs are cached in memory with TTLs.
