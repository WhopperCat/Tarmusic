// Tarmusic — frontend
(() => {
  const view = document.getElementById("view");
  const audio = document.getElementById("audio");

  const npArt = document.getElementById("np-art");
  const npTitle = document.getElementById("np-title");
  const npArtist = document.getElementById("np-artist");

  const btnPlay = document.getElementById("btn-play");
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const btnLyrics = document.getElementById("btn-lyrics");

  const seek = document.getElementById("seek");
  const tCur = document.getElementById("t-cur");
  const tDur = document.getElementById("t-dur");
  const volume = document.getElementById("volume");

  const lyricsPanel = document.getElementById("lyrics-panel");
  const lyricsBody = document.getElementById("lyrics-body");
  const lyricsSource = document.getElementById("lyrics-source");
  const lyricsMode = document.getElementById("lyrics-mode");
  document.getElementById("lyrics-close").onclick = () =>
    lyricsPanel.classList.add("hidden");

  // current lyrics state, kept in closure for the rAF tick loop
  let lyricsState = {
    videoId: null,
    format: "plain",
    lines: [],
    lineNodes: [],
    activeIdx: -1,
  };

  // ---- queue & playback state -------------------------------------------
  const queue = []; // [{ videoId, title, artist, thumbnail }]
  let queueIndex = -1;

  function fmtTime(s) {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, "0")}`;
  }

  function thumbOf(item) {
    const t = item.thumbnails || item.thumbnail;
    if (!t) return "";
    if (Array.isArray(t)) return t[t.length - 1]?.url || "";
    return t;
  }

  function artistText(item) {
    if (!item.artists) return "";
    if (Array.isArray(item.artists))
      return item.artists.map((a) => a.name || a).join(", ");
    return item.artists;
  }

  async function api(path) {
    const r = await fetch(path);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    return r.json();
  }

  function setStatus(node, msg) {
    node.innerHTML = `<div class="skeleton">${msg}</div>`;
  }

  function showError(node, msg) {
    node.innerHTML = `<div class="error">${msg}</div>`;
  }

  // ---- playback ----------------------------------------------------------
  function playTrack(track, opts = {}) {
    if (!track?.videoId) return;
    audio.src = `/api/stream/${track.videoId}`;
    audio.play().catch((e) => console.warn("autoplay blocked", e));
    npTitle.textContent = track.title || "";
    npArtist.textContent = track.artist || "";
    npArt.src = track.thumbnail || "";
    btnPlay.textContent = "❚❚";
    document.title = `${track.title} — Tarmusic`;
    if (opts.loadLyrics !== false) maybeLoadLyrics(track.videoId);
    markPlayingRow(track.videoId);
  }

  function setQueue(tracks, startIndex = 0) {
    queue.length = 0;
    queue.push(...tracks);
    queueIndex = startIndex;
    if (queue[queueIndex]) playTrack(queue[queueIndex]);
  }

  function enqueueAndPlay(track) {
    queue.splice(queueIndex + 1, 0, track);
    queueIndex += 1;
    playTrack(track);
  }

  async function appendRelated(videoId) {
    try {
      const w = await api(`/api/watch/${videoId}`);
      const tracks = (w.tracks || [])
        .filter((t) => t.videoId && t.videoId !== videoId)
        .map((t) => ({
          videoId: t.videoId,
          title: t.title,
          artist: artistText(t),
          thumbnail: thumbOf(t),
        }));
      // de-dupe against current queue
      const seen = new Set(queue.map((q) => q.videoId));
      for (const t of tracks)
        if (!seen.has(t.videoId)) {
          queue.push(t);
          seen.add(t.videoId);
        }
    } catch (e) {
      console.warn("related fetch failed", e);
    }
  }

  btnPlay.onclick = () => {
    if (!audio.src) return;
    if (audio.paused) audio.play();
    else audio.pause();
  };
  audio.onplay = () => (btnPlay.textContent = "❚❚");
  audio.onpause = () => (btnPlay.textContent = "▶");
  audio.onended = () => {
    if (queueIndex < queue.length - 1) {
      queueIndex += 1;
      playTrack(queue[queueIndex]);
    }
  };
  btnNext.onclick = async () => {
    if (queueIndex >= queue.length - 1 && queue[queueIndex]) {
      await appendRelated(queue[queueIndex].videoId);
    }
    if (queueIndex < queue.length - 1) {
      queueIndex += 1;
      playTrack(queue[queueIndex]);
    }
  };
  btnPrev.onclick = () => {
    if (audio.currentTime > 3 || queueIndex <= 0) {
      audio.currentTime = 0;
    } else {
      queueIndex -= 1;
      playTrack(queue[queueIndex]);
    }
  };

  audio.ontimeupdate = () => {
    if (!isFinite(audio.duration)) return;
    seek.value = String((audio.currentTime / audio.duration) * 1000);
    tCur.textContent = fmtTime(audio.currentTime);
    tDur.textContent = fmtTime(audio.duration);
  };
  seek.oninput = () => {
    if (!isFinite(audio.duration)) return;
    audio.currentTime = (seek.value / 1000) * audio.duration;
  };

  volume.value = String(Math.round((parseFloat(localStorage.vol ?? "0.8")) * 100));
  audio.volume = volume.value / 100;
  volume.oninput = () => {
    audio.volume = volume.value / 100;
    localStorage.vol = String(audio.volume);
  };

  // when a new track loads its related queue, fetch more in the background
  audio.onloadedmetadata = async () => {
    const here = queue[queueIndex];
    if (here && queueIndex >= queue.length - 3) {
      await appendRelated(here.videoId);
    }
  };

  // ---- lyrics ------------------------------------------------------------
  function setLyricsStatus(msg) {
    lyricsBody.innerHTML = `<div class="lyrics-status">${escapeHtml(msg)}</div>`;
    lyricsState.lineNodes = [];
    lyricsState.activeIdx = -1;
  }

  function renderLyrics(data) {
    lyricsMode.textContent =
      data.format === "word"
        ? "Word-synced"
        : data.format === "line"
          ? "Line-synced"
          : "Static";
    lyricsSource.textContent = data.source
      ? `Source: ${data.source} · ${data.format}`
      : "";

    if (!data.lines || !data.lines.length) {
      setLyricsStatus("No lyrics found for this track.");
      return;
    }

    lyricsBody.innerHTML = "";
    const nodes = [];
    data.lines.forEach((line, i) => {
      const el = document.createElement("div");
      el.className = "lyric-line";
      el.dataset.idx = String(i);
      if (data.format === "word" && line.words?.length > 1) {
        line.words.forEach((w) => {
          const span = document.createElement("span");
          span.className = "lyric-word";
          span.textContent = w.text;
          span.dataset.time = String(w.time ?? "");
          el.appendChild(span);
        });
      } else {
        el.textContent = (line.words || [{ text: "" }])
          .map((w) => w.text)
          .join("");
      }
      el.onclick = () => {
        if (line.time != null) audio.currentTime = line.time;
      };
      lyricsBody.appendChild(el);
      nodes.push(el);
    });
    lyricsState.lineNodes = nodes;
    lyricsState.activeIdx = -1;
  }

  async function loadLyrics(videoId) {
    if (lyricsState.videoId === videoId) return;
    lyricsState = {
      videoId,
      format: "plain",
      lines: [],
      lineNodes: [],
      activeIdx: -1,
    };
    setLyricsStatus("Loading lyrics…");
    try {
      const data = await api(`/api/lyrics/${videoId}`);
      // ensure we're still on the same track
      if (lyricsState.videoId !== videoId) return;
      lyricsState.format = data.format;
      lyricsState.lines = data.lines || [];
      renderLyrics(data);
    } catch (e) {
      if (lyricsState.videoId !== videoId) return;
      setLyricsStatus(`Couldn't fetch lyrics: ${e.message}`);
    }
  }

  async function maybeLoadLyrics(videoId) {
    if (lyricsPanel.classList.contains("hidden")) return;
    await loadLyrics(videoId);
  }

  btnLyrics.onclick = () => {
    lyricsPanel.classList.toggle("hidden");
    const here = queue[queueIndex];
    if (here && !lyricsPanel.classList.contains("hidden"))
      loadLyrics(here.videoId);
  };

  // tick loop: highlight active line + sung words, smooth-scroll
  function tickLyrics() {
    const { lines, lineNodes } = lyricsState;
    if (!lines.length || !lineNodes.length || lyricsPanel.classList.contains("hidden")) {
      requestAnimationFrame(tickLyrics);
      return;
    }
    const t = audio.currentTime;
    // binary search for active line (largest time <= t)
    let lo = 0,
      hi = lines.length - 1,
      idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const mt = lines[mid].time;
      if (mt == null || mt <= t) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (idx !== lyricsState.activeIdx) {
      if (lyricsState.activeIdx >= 0) {
        const prev = lineNodes[lyricsState.activeIdx];
        prev?.classList.remove("active");
        prev?.classList.add("past");
      }
      const cur = lineNodes[idx];
      if (cur) {
        cur.classList.add("active");
        cur.classList.remove("past");
        // center it
        cur.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      lyricsState.activeIdx = idx;
    }

    // word-level sweep within the active line
    if (lyricsState.format === "word" && idx >= 0) {
      const cur = lineNodes[idx];
      if (cur) {
        const spans = cur.querySelectorAll(".lyric-word");
        spans.forEach((span) => {
          const wt = parseFloat(span.dataset.time);
          if (!isFinite(wt)) return;
          if (t >= wt) {
            span.classList.add("sung");
            span.classList.remove("upcoming");
          } else {
            span.classList.add("upcoming");
            span.classList.remove("sung");
          }
        });
      }
    }

    requestAnimationFrame(tickLyrics);
  }
  requestAnimationFrame(tickLyrics);

  // ---- rendering helpers -------------------------------------------------
  function songRow(item, idx, opts = {}) {
    const row = document.createElement("div");
    row.className = "row";
    row.dataset.videoId = item.videoId || "";
    row.innerHTML = `
      <div class="idx">${idx + 1}</div>
      <img src="${thumbOf(item)}" alt="" />
      <div class="meta">
        <div class="t">${escapeHtml(item.title || "")}</div>
        <div class="s">${escapeHtml(artistText(item))}</div>
      </div>
      <div class="a">${escapeHtml(item.album?.name || "")}</div>
      <div class="d">${escapeHtml(item.duration || "")}</div>
    `;
    row.onclick = () => {
      if (opts.onClick) opts.onClick(item, idx);
      else if (item.videoId)
        enqueueAndPlay({
          videoId: item.videoId,
          title: item.title,
          artist: artistText(item),
          thumbnail: thumbOf(item),
        });
    };
    return row;
  }

  function escapeHtml(s) {
    return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function markPlayingRow(videoId) {
    document.querySelectorAll(".row.playing").forEach((r) =>
      r.classList.remove("playing"),
    );
    document
      .querySelectorAll(`.row[data-video-id="${videoId}"]`)
      .forEach((r) => r.classList.add("playing"));
  }

  function entityCard(item) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img src="${thumbOf(item)}" alt="" />
      <div class="ct">${escapeHtml(item.title || item.name || "")}</div>
      <div class="cs">${escapeHtml(
        item.resultType ||
          (item.subscribers ? `${item.subscribers} subscribers` : "") ||
          (item.year ?? ""),
      )}</div>
    `;
    card.onclick = () => openEntity(item);
    return card;
  }

  function openEntity(item) {
    if (item.videoId) {
      enqueueAndPlay({
        videoId: item.videoId,
        title: item.title,
        artist: artistText(item),
        thumbnail: thumbOf(item),
      });
      return;
    }
    if (item.browseId && (item.resultType === "album" || item.type === "album")) {
      renderAlbum(item.browseId);
      return;
    }
    if (item.browseId && (item.resultType === "artist" || item.type === "artist")) {
      renderArtist(item.browseId);
      return;
    }
    if (
      item.browseId &&
      (item.resultType === "playlist" || item.type === "playlist")
    ) {
      const pid = item.playlistId || item.browseId.replace(/^VL/, "");
      renderPlaylist(pid);
      return;
    }
    if (item.playlistId) renderPlaylist(item.playlistId);
  }

  // ---- views -------------------------------------------------------------
  async function renderHome() {
    setStatus(view, "Loading charts…");
    try {
      const c = await api("/api/charts");
      const parts = [];
      parts.push(`<h1>Trending now</h1>`);
      parts.push(`<p class="subtitle">Global YouTube Music charts</p>`);

      const songs = c.songs?.items || c.trending?.items || [];
      if (songs.length) {
        parts.push(`<h2>Top songs</h2><div id="home-songs" class="row-list"></div>`);
      }
      const videos = c.videos?.items || [];
      if (videos.length) {
        parts.push(`<h2>Top videos</h2><div id="home-videos" class="grid"></div>`);
      }
      const artists = c.artists?.items || [];
      if (artists.length) {
        parts.push(`<h2>Top artists</h2><div id="home-artists" class="grid"></div>`);
      }
      view.innerHTML = parts.join("\n");

      const songsEl = document.getElementById("home-songs");
      songs.forEach((s, i) => songsEl?.appendChild(songRow(s, i)));
      const videosEl = document.getElementById("home-videos");
      videos.forEach((v) => videosEl?.appendChild(entityCard(v)));
      const artistsEl = document.getElementById("home-artists");
      artists.forEach((a) =>
        artistsEl?.appendChild(
          entityCard({
            title: a.title,
            thumbnails: a.thumbnails,
            browseId: a.browseId,
            resultType: "artist",
          }),
        ),
      );

      if (!songs.length && !videos.length && !artists.length) {
        view.innerHTML +=
          '<div class="empty">Charts came back empty. Try a search above.</div>';
      }
    } catch (e) {
      showError(view, `Couldn't load charts: ${e.message}`);
    }
  }

  async function renderSearch(query, filter) {
    setStatus(view, `Searching “${query}”…`);
    try {
      const params = new URLSearchParams({ q: query });
      if (filter) params.set("filter", filter);
      const data = await api(`/api/search?${params.toString()}`);

      // group by resultType
      const groups = {};
      for (const r of data.results || []) {
        const k = r.resultType || r.category || "other";
        (groups[k] ||= []).push(r);
      }
      const parts = [`<h1>Results for “${escapeHtml(query)}”</h1>`];

      const groupOrder = ["song", "video", "album", "artist", "playlist"];
      const seen = new Set();
      for (const g of groupOrder.concat(Object.keys(groups))) {
        if (seen.has(g) || !groups[g]) continue;
        seen.add(g);
        parts.push(`<h2>${g}s</h2><div id="g-${g}"></div>`);
      }
      view.innerHTML = parts.join("\n");

      for (const g of seen) {
        const items = groups[g];
        const host = document.getElementById(`g-${g}`);
        if (!host) continue;
        if (g === "song" || g === "video") {
          host.classList.add("row-list");
          items.forEach((it, i) => host.appendChild(songRow(it, i)));
        } else {
          host.classList.add("grid");
          items.forEach((it) => host.appendChild(entityCard(it)));
        }
      }

      if (!data.results?.length) {
        view.innerHTML += '<div class="empty">No results.</div>';
      }
    } catch (e) {
      showError(view, `Search failed: ${e.message}`);
    }
  }

  async function renderArtist(channelId) {
    setStatus(view, "Loading artist…");
    try {
      const a = await api(`/api/artist/${channelId}`);
      const parts = [];
      parts.push(`<div class="hero">
        <img src="${thumbOf(a)}" alt="" />
        <div class="info">
          <div class="kicker">Artist</div>
          <h1>${escapeHtml(a.name || "")}</h1>
          ${
            a.subscribers
              ? `<p class="subtitle">${escapeHtml(a.subscribers)} subscribers</p>`
              : ""
          }
        </div>
      </div>`);

      const songs = a.songs?.results || [];
      if (songs.length) {
        parts.push(`<h2>Top songs</h2><div id="ar-songs" class="row-list"></div>`);
      }
      const albums = a.albums?.results || [];
      if (albums.length) {
        parts.push(`<h2>Albums</h2><div id="ar-albums" class="grid"></div>`);
      }
      const singles = a.singles?.results || [];
      if (singles.length) {
        parts.push(`<h2>Singles</h2><div id="ar-singles" class="grid"></div>`);
      }
      const related = a.related?.results || [];
      if (related.length) {
        parts.push(`<h2>Related artists</h2><div id="ar-rel" class="grid"></div>`);
      }
      view.innerHTML = parts.join("\n");

      const songsEl = document.getElementById("ar-songs");
      songs.forEach((s, i) => songsEl?.appendChild(songRow(s, i)));
      const albumsEl = document.getElementById("ar-albums");
      albums.forEach((al) =>
        albumsEl?.appendChild(
          entityCard({
            title: al.title,
            thumbnails: al.thumbnails,
            browseId: al.browseId,
            resultType: "album",
            year: al.year,
          }),
        ),
      );
      const singlesEl = document.getElementById("ar-singles");
      singles.forEach((al) =>
        singlesEl?.appendChild(
          entityCard({
            title: al.title,
            thumbnails: al.thumbnails,
            browseId: al.browseId,
            resultType: "album",
            year: al.year,
          }),
        ),
      );
      const relEl = document.getElementById("ar-rel");
      related.forEach((r) =>
        relEl?.appendChild(
          entityCard({
            title: r.title,
            thumbnails: r.thumbnails,
            browseId: r.browseId,
            resultType: "artist",
          }),
        ),
      );
    } catch (e) {
      showError(view, `Couldn't load artist: ${e.message}`);
    }
  }

  async function renderAlbum(browseId) {
    setStatus(view, "Loading album…");
    try {
      const a = await api(`/api/album/${browseId}`);
      const tracks = a.tracks || [];
      view.innerHTML = `
        <div class="hero">
          <img src="${thumbOf(a)}" alt="" />
          <div class="info">
            <div class="kicker">${escapeHtml(a.type || "Album")}</div>
            <h1>${escapeHtml(a.title || "")}</h1>
            <p class="subtitle">${escapeHtml(artistText(a))} ${
              a.year ? `· ${a.year}` : ""
            } · ${tracks.length} tracks</p>
            <button id="play-album">▶ Play album</button>
          </div>
        </div>
        <div id="al-tracks" class="row-list"></div>
      `;
      const host = document.getElementById("al-tracks");
      tracks.forEach((t, i) => {
        // album track items don't carry their own thumbnails — inherit album art
        if (!t.thumbnails) t.thumbnails = a.thumbnails;
        if (!t.artists) t.artists = a.artists;
        host.appendChild(
          songRow(t, i, {
            onClick: () => {
              const list = tracks
                .filter((x) => x.videoId)
                .map((x) => ({
                  videoId: x.videoId,
                  title: x.title,
                  artist: artistText(x),
                  thumbnail: thumbOf(x),
                }));
              const start = list.findIndex((x) => x.videoId === t.videoId);
              setQueue(list, start);
            },
          }),
        );
      });
      document.getElementById("play-album").onclick = () => {
        const list = tracks
          .filter((t) => t.videoId)
          .map((t) => ({
            videoId: t.videoId,
            title: t.title,
            artist: artistText(t),
            thumbnail: thumbOf(t),
          }));
        if (list.length) setQueue(list, 0);
      };
    } catch (e) {
      showError(view, `Couldn't load album: ${e.message}`);
    }
  }

  async function renderPlaylist(playlistId) {
    setStatus(view, "Loading playlist…");
    try {
      const p = await api(`/api/playlist/${playlistId}`);
      const tracks = p.tracks || [];
      view.innerHTML = `
        <div class="hero">
          <img src="${thumbOf(p)}" alt="" />
          <div class="info">
            <div class="kicker">Playlist</div>
            <h1>${escapeHtml(p.title || "")}</h1>
            <p class="subtitle">${tracks.length} tracks</p>
            <button id="play-pl">▶ Play playlist</button>
          </div>
        </div>
        <div id="pl-tracks" class="row-list"></div>
      `;
      const host = document.getElementById("pl-tracks");
      tracks.forEach((t, i) =>
        host.appendChild(
          songRow(t, i, {
            onClick: () => {
              const list = tracks
                .filter((x) => x.videoId)
                .map((x) => ({
                  videoId: x.videoId,
                  title: x.title,
                  artist: artistText(x),
                  thumbnail: thumbOf(x),
                }));
              const start = list.findIndex((x) => x.videoId === t.videoId);
              setQueue(list, start);
            },
          }),
        ),
      );
      document.getElementById("play-pl").onclick = () => {
        const list = tracks
          .filter((t) => t.videoId)
          .map((t) => ({
            videoId: t.videoId,
            title: t.title,
            artist: artistText(t),
            thumbnail: thumbOf(t),
          }));
        if (list.length) setQueue(list, 0);
      };
    } catch (e) {
      showError(view, `Couldn't load playlist: ${e.message}`);
    }
  }

  // ---- wiring ------------------------------------------------------------
  document.getElementById("search-form").onsubmit = (e) => {
    e.preventDefault();
    const q = document.getElementById("search-input").value.trim();
    const f = document.getElementById("search-filter").value;
    if (q) renderSearch(q, f);
  };

  document.querySelector('[data-route="home"]').onclick = (e) => {
    e.preventDefault();
    renderHome();
  };

  renderHome();
})();
