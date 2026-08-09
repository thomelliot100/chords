/* ============================================================
   Guitar Songbook — app logic
   - ChordPro parsing + rendering (chords sit above lyrics)
   - Transpose (per song, remembered)
   - Auto-scroll with adjustable speed, tap to pause
   - Swipe left/right between songs
   - Font size, dark/light, offline (see sw.js)
   ============================================================ */

(function () {
  "use strict";

  // ---- Note maths for transpose -------------------------------------------
  const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const FLAT  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb", "Dm", "Gm", "Cm", "Fm", "Bbm"]);

  function noteIndex(note) {
    let i = SHARP.indexOf(note);
    if (i >= 0) return i;
    i = FLAT.indexOf(note);
    return i; // -1 if not found
  }

  // Transpose a single chord token like "G", "Am7", "D/F#", "Cadd9"
  function transposeChord(chord, steps, useFlats) {
    if (!chord) return chord;
    // Slash chord: transpose both parts
    const slash = chord.split("/");
    const out = slash.map(function (part) {
      const m = part.match(/^([A-G][#b]?)(.*)$/);
      if (!m) return part; // not a chord (e.g. "N.C.")
      const root = m[1];
      const suffix = m[2];
      let idx = noteIndex(root);
      if (idx < 0) return part;
      idx = (((idx + steps) % 12) + 12) % 12;
      const name = (useFlats ? FLAT : SHARP)[idx];
      return name + suffix;
    });
    return out.join("/");
  }

  // ---- ChordPro parsing ----------------------------------------------------
  // A line becomes an array of { chord, text } cells. Chord may be "".
  function parseLine(line) {
    const cells = [];
    const re = /\[([^\]]*)\]/g;
    let last = 0;
    let pendingChord = "";
    let m;
    while ((m = re.exec(line)) !== null) {
      const text = line.slice(last, m.index);
      if (text.length > 0 || pendingChord) {
        cells.push({ chord: pendingChord, text: text });
      }
      pendingChord = m[1];
      last = re.lastIndex;
    }
    const tail = line.slice(last);
    if (tail.length > 0 || pendingChord) {
      cells.push({ chord: pendingChord, text: tail });
    }
    if (cells.length === 0) cells.push({ chord: "", text: "" });
    return cells;
  }

  // Parse a whole song body into a list of blocks.
  function parseSong(body) {
    const lines = body.replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    lines.forEach(function (raw) {
      const line = raw;
      const dir = line.match(/^\s*\{\s*(c|comment)\s*:\s*(.*?)\s*\}\s*$/i);
      if (dir) {
        blocks.push({ type: "label", text: dir[2] });
        return;
      }
      // ignore other unknown {directives}
      if (/^\s*\{.*\}\s*$/.test(line)) return;
      if (line.trim() === "") {
        blocks.push({ type: "space" });
        return;
      }
      blocks.push({ type: "line", cells: parseLine(line) });
    });
    return blocks;
  }

  // ---- State ---------------------------------------------------------------
  const store = {
    get: function (k, d) {
      try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  const songs = (window.SONGS || []).map(function (s, i) {
    return {
      id: (s.title + "|" + s.artist).toLowerCase(),
      index: i,
      title: s.title || "Untitled",
      artist: s.artist || "",
      key: s.key || "",
      capo: s.capo || 0,
      blocks: parseSong(s.body || "")
    };
  });

  let current = -1;                       // index into songs, -1 = library view
  let fontSize = store.get("fontSize", 20);
  let dark = store.get("dark", true);
  let scrolling = false;
  let scrollSpeed = store.get("scrollSpeed", 3); // 1..10
  let rafId = null;
  let scrollAccum = 0;

  // ---- DOM refs ------------------------------------------------------------
  const $ = function (id) { return document.getElementById(id); };
  const libraryEl = $("library");
  const songListEl = $("songList");
  const viewerEl = $("viewer");
  const sheetEl = $("sheet");
  const titleEl = $("songTitle");
  const metaEl = $("songMeta");
  const transposeLabel = $("transposeLabel");
  const speedInput = $("speedInput");
  const playBtn = $("playBtn");
  const searchEl = $("search");

  // ---- Library rendering ---------------------------------------------------
  function renderLibrary(filter) {
    songListEl.innerHTML = "";
    const f = (filter || "").trim().toLowerCase();
    let shown = 0;
    songs.forEach(function (song) {
      if (f && (song.title + " " + song.artist).toLowerCase().indexOf(f) === -1) return;
      shown++;
      const card = document.createElement("button");
      card.className = "song-card";
      card.innerHTML =
        '<span class="song-card-title"></span>' +
        '<span class="song-card-artist"></span>' +
        '<span class="song-card-key"></span>';
      card.querySelector(".song-card-title").textContent = song.title;
      card.querySelector(".song-card-artist").textContent = song.artist;
      card.querySelector(".song-card-key").textContent = song.key ? "Key " + song.key : "";
      card.addEventListener("click", function () { openSong(song.index); });
      songListEl.appendChild(card);
    });
    if (shown === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = songs.length === 0
        ? "No songs yet. Add them in songs.js."
        : "No songs match your search.";
      songListEl.appendChild(empty);
    }
  }

  // ---- Song rendering ------------------------------------------------------
  function transposeFor(song) {
    return store.get("t:" + song.id, 0);
  }
  function setTransposeFor(song, val) {
    store.set("t:" + song.id, val);
  }

  function renderSong() {
    const song = songs[current];
    if (!song) return;
    const steps = transposeFor(song);
    const useFlats = FLAT_KEYS.has(transposeKey(song.key, steps)) || (steps === 0 && FLAT_KEYS.has(song.key));

    titleEl.textContent = song.title;
    let meta = song.artist || "";
    const shownKey = transposeKey(song.key, steps);
    if (shownKey) meta += (meta ? "  ·  " : "") + "Key " + shownKey;
    if (song.capo) meta += "  ·  Capo " + song.capo;
    metaEl.textContent = meta;
    transposeLabel.textContent = steps === 0 ? "0" : (steps > 0 ? "+" + steps : "" + steps);

    sheetEl.innerHTML = "";
    song.blocks.forEach(function (b) {
      if (b.type === "space") {
        const d = document.createElement("div");
        d.className = "spacer";
        sheetEl.appendChild(d);
        return;
      }
      if (b.type === "label") {
        const d = document.createElement("div");
        d.className = "section-label";
        d.textContent = b.text;
        sheetEl.appendChild(d);
        return;
      }
      const lineEl = document.createElement("div");
      lineEl.className = "line";
      b.cells.forEach(function (cell) {
        const pair = document.createElement("span");
        pair.className = "pair";
        const chord = document.createElement("span");
        chord.className = "chord";
        chord.textContent = cell.chord ? transposeChord(cell.chord, steps, useFlats) : "";
        const lyric = document.createElement("span");
        lyric.className = "lyric";
        lyric.textContent = cell.text.length ? cell.text : "";
        pair.appendChild(chord);
        pair.appendChild(lyric);
        lineEl.appendChild(pair);
      });
      sheetEl.appendChild(lineEl);
    });
  }

  function transposeKey(key, steps) {
    if (!key) return "";
    const m = key.match(/^([A-G][#b]?)(.*)$/);
    if (!m) return key;
    const minor = /m/.test(m[2]) ? "m" : "";
    const useFlats = FLAT_KEYS.has(key);
    return transposeChord(m[1], steps, useFlats) + minor;
  }

  // ---- Navigation ----------------------------------------------------------
  function openSong(index) {
    stopScroll();
    current = index;
    store.set("lastSong", index);
    renderSong();
    libraryEl.classList.add("hidden");
    viewerEl.classList.remove("hidden");
    sheetEl.scrollTop = 0;
    applyFont();
  }

  function backToLibrary() {
    stopScroll();
    current = -1;
    viewerEl.classList.add("hidden");
    libraryEl.classList.remove("hidden");
  }

  function nextSong() {
    if (current < 0) return;
    if (current < songs.length - 1) openSong(current + 1);
  }
  function prevSong() {
    if (current < 0) return;
    if (current > 0) openSong(current - 1);
  }

  // ---- Transpose controls --------------------------------------------------
  function bumpTranspose(delta) {
    const song = songs[current];
    if (!song) return;
    let t = transposeFor(song) + delta;
    if (t > 11) t = 11;
    if (t < -11) t = -11;
    setTransposeFor(song, t);
    renderSong();
  }

  // ---- Font ----------------------------------------------------------------
  function applyFont() {
    document.documentElement.style.setProperty("--sheet-font", fontSize + "px");
  }
  function bumpFont(delta) {
    fontSize = Math.max(12, Math.min(40, fontSize + delta));
    store.set("fontSize", fontSize);
    applyFont();
  }

  // ---- Auto-scroll ---------------------------------------------------------
  function tick() {
    if (!scrolling) return;
    // pixels per frame scale with speed (1..10). ~0.15px/frame at speed 1.
    scrollAccum += scrollSpeed * 0.18;
    if (scrollAccum >= 1) {
      const whole = Math.floor(scrollAccum);
      sheetEl.scrollTop += whole;
      scrollAccum -= whole;
    }
    const atBottom = sheetEl.scrollTop + sheetEl.clientHeight >= sheetEl.scrollHeight - 1;
    if (atBottom) { stopScroll(); return; }
    rafId = requestAnimationFrame(tick);
  }
  function startScroll() {
    if (scrolling) return;
    scrolling = true;
    scrollAccum = 0;
    playBtn.classList.add("playing");
    playBtn.setAttribute("aria-label", "Pause auto-scroll");
    rafId = requestAnimationFrame(tick);
  }
  function stopScroll() {
    scrolling = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    playBtn.classList.remove("playing");
    playBtn.setAttribute("aria-label", "Start auto-scroll");
  }
  function toggleScroll() { scrolling ? stopScroll() : startScroll(); }

  // ---- Theme ---------------------------------------------------------------
  function applyTheme() {
    document.documentElement.classList.toggle("light", !dark);
  }

  // ---- Wire up controls ----------------------------------------------------
  function init() {
    applyTheme();
    applyFont();
    speedInput.value = scrollSpeed;

    $("backBtn").addEventListener("click", backToLibrary);
    $("prevBtn").addEventListener("click", prevSong);
    $("nextBtn").addEventListener("click", nextSong);
    $("transDown").addEventListener("click", function () { bumpTranspose(-1); });
    $("transUp").addEventListener("click", function () { bumpTranspose(1); });
    $("fontDown").addEventListener("click", function () { bumpFont(-2); });
    $("fontUp").addEventListener("click", function () { bumpFont(2); });
    $("themeBtn").addEventListener("click", function () {
      dark = !dark; store.set("dark", dark); applyTheme();
    });

    playBtn.addEventListener("click", toggleScroll);
    speedInput.addEventListener("input", function () {
      scrollSpeed = parseInt(speedInput.value, 10);
      store.set("scrollSpeed", scrollSpeed);
    });

    // Tap the sheet to pause/resume (but not while selecting text via buttons)
    sheetEl.addEventListener("click", function () {
      if (scrolling) stopScroll();
    });

    searchEl.addEventListener("input", function () { renderLibrary(searchEl.value); });

    // Swipe left/right on the sheet to change songs
    let sx = 0, sy = 0, tracking = false;
    sheetEl.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    sheetEl.addEventListener("touchend", function (e) {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) {
        if (dx < 0) nextSong(); else prevSong();
      }
    }, { passive: true });

    // Keyboard (nice on desktop / bluetooth pedals that send arrows)
    document.addEventListener("keydown", function (e) {
      if (current < 0) return;
      if (e.key === "ArrowRight") nextSong();
      else if (e.key === "ArrowLeft") prevSong();
      else if (e.key === " ") { e.preventDefault(); toggleScroll(); }
      else if (e.key === "Escape") backToLibrary();
    });

    renderLibrary("");
    // Optionally jump straight back to last song? Keep on library for choice.
  }

  document.addEventListener("DOMContentLoaded", init);
})();
