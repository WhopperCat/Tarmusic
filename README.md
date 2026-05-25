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

## Deploy

The app needs a real persistent Python server (not a serverless function — see below). The repo ships a `Dockerfile` that works anywhere.

### Fly.io (recommended)

```bash
# one time
brew install flyctl       # or: curl -L https://fly.io/install.sh | sh
fly auth signup           # or: fly auth login

# from the repo root
fly launch --copy-config --no-deploy   # pick an app name, region; keeps fly.toml
fly deploy
fly open
```

`fly.toml` is preconfigured for a 512MB shared-cpu-1x machine in `iad` with auto-stop when idle (so it's effectively free for personal use). Bump memory if you see OOMs while many concurrent streams are active.

### Render

Push the repo to GitHub, then "New +" → "Blueprint" and point at the repo. `render.yaml` is included. Or create a Web Service manually with runtime "Docker" and the included `Dockerfile`.

### Why not Netlify / Vercel / Cloudflare Workers?

The `/api/stream` route holds a long-lived connection while it proxies audio through. Netlify Functions cap at 10s sync / 26s background, Vercel at 60s on Hobby — neither can stream a 3-minute song. The YouTube audio URL is also IP-bound to the resolver, so you can't just hand the URL to the browser. A persistent VM is required.

## Caveats

- True per-word lyrics depend on the source. Most popular songs have line-level synced lyrics on LRCLIB/NetEase; word-level lyrics depend on Musixmatch Richsync being reachable. The renderer transparently uses whatever it gets.
- Audio URLs from `yt-dlp` expire and are IP-bound — that's why this proxies the stream rather than redirecting clients to it. Lyrics and audio URLs are cached in memory with TTLs.
