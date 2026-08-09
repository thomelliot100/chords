/* ============================================================
   Guitar Songbook — app logic
   - ChordPro parsing + rendering (chords sit above lyrics)
   - Transpose (per song, remembered)
   - Auto-scroll with adjustable speed
   - Tap to page forward (top of screen = page back)
   - Tap a chord to see its fingering diagram
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
    return i;
  }

  function transposeChord(chord, steps, useFlats) {
    if (!chord) return chord;
    const slash = chord.split("/");
    const out = slash.map(function (part) {
      const m = part.match(/^([A-G][#b]?)(.*)$/);
      if (!m) return part;
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

  function parseSong(body) {
    const lines = body.replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    lines.forEach(function (line) {
      const dir = line.match(/^\s*\{\s*(c|comment)\s*:\s*(.*?)\s*\}\s*$/i);
      if (dir) { blocks.push({ type: "label", text: dir[2] }); return; }
      if (/^\s*\{.*\}\s*$/.test(line)) return;
      if (line.trim() === "") { blocks.push({ type: "space" }); return; }
      blocks.push({ type: "line", cells: parseLine(line) });
    });
    return blocks;
  }

  // ---- Chart import --------------------------------------------------------
  // Most charts in the wild put chords on their own row above the lyric, lined
  // up by column. Convert that to inline ChordPro so the renderer can use it.

  const CHORD_TOKEN =
    /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M)*[0-9]*(?:sus[0-9]|add[0-9]+)?(?:\/[A-G][#b]?)?$/;

  // Tokens that may sit on a chord row: chords, bar lines, beat dots, repeats.
  function isChordish(tok) {
    if (!tok) return false;
    if (tok === "." || /^\|+$/.test(tok) || /^\(?x ?[0-9]+\)?$/i.test(tok)) return true;
    if (/^n\.?c\.?$/i.test(tok)) return true;
    return CHORD_TOKEN.test(tok);
  }

  function isChordLine(line) {
    if (!line.trim()) return false;
    const toks = line.trim().split(/\s+/);
    let chords = 0;
    for (let i = 0; i < toks.length; i++) {
      if (!isChordish(toks[i])) return false;
      if (/^[A-G]/.test(toks[i])) chords++;
    }
    return chords > 0;
  }

  function tokensWithColumns(line) {
    const out = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(line)) !== null) out.push({ col: m.index, tok: m[0] });
    return out;
  }

  // A heading like "[Chorus]" or "Verse 2:" — but not a bare chord like "[C]".
  function sectionName(line) {
    let m = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (m) return isChordish(m[1].trim()) ? null : m[1].trim();
    m = line.match(/^\s*([A-Za-z][A-Za-z0-9 '&/()-]{1,28}):\s*$/);
    if (m) return m[1].trim();
    return null;
  }

  function mergeChordLine(chordLine, lyricLine) {
    const baseLen = lyricLine.length;
    const marks = tokensWithColumns(chordLine)
      .filter(function (p) { return /^[A-G]/.test(p.tok); })
      .map(function (p) { return { tok: p.tok, at: Math.min(p.col, baseLen) }; });
    let lyric = lyricLine;
    // Insert right-to-left so the earlier column indices stay valid.
    for (let i = marks.length - 1; i >= 0; i--) {
      lyric = lyric.slice(0, marks[i].at) + "[" + marks[i].tok + "]" + lyric.slice(marks[i].at);
    }
    return lyric;
  }

  function looksLikeChordPro(text) {
    return /\[[A-G][^\]]*\]\S/.test(text) || /\{\s*c(omment)?\s*:/i.test(text);
  }

  function chartToChordPro(text) {
    const src = text.replace(/\r\n/g, "\n").replace(/\t/g, "    ").split("\n");
    const out = [];
    for (let i = 0; i < src.length; i++) {
      const line = src[i];
      const sec = sectionName(line);
      if (sec) { out.push("{c: " + sec + "}"); continue; }
      if (!line.trim()) { out.push(""); continue; }
      if (isChordLine(line)) {
        const next = src[i + 1];
        if (next !== undefined && next.trim() && !isChordLine(next) && !sectionName(next)) {
          out.push(mergeChordLine(line, next));
          i++;
          continue;
        }
        // Chord-only row: keep the chords, drop the column padding.
        out.push(tokensWithColumns(line).map(function (p) {
          return /^[A-G]/.test(p.tok) ? "[" + p.tok + "]" : p.tok;
        }).join(" "));
        continue;
      }
      out.push(line);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // Already-ChordPro text only needs its section headings normalised.
  function importToBody(text) {
    if (!text) return "";
    if (looksLikeChordPro(text)) {
      return text.replace(/\r\n/g, "\n").split("\n").map(function (l) {
        const s = sectionName(l);
        return s ? "{c: " + s + "}" : l;
      }).join("\n").trim();
    }
    return chartToChordPro(text);
  }

  // ---- State ---------------------------------------------------------------
  const store = {
    get: function (k, d) {
      try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  // Songs you import live in local storage on this device only — they are not
  // part of the repo and never leave the browser unless you export them.
  function loadUserSongs() {
    const list = store.get("userSongs", []);
    return Array.isArray(list) ? list : [];
  }
  function saveUserSongs(list) { store.set("userSongs", list); }

  function makeSong(s, i) {
    return {
      id: (s.title + "|" + s.artist).toLowerCase(),
      index: i,
      title: s.title || "Untitled",
      artist: s.artist || "",
      key: s.key || "",
      capo: s.capo || 0,
      custom: !!s.custom,
      body: s.body || "",
      blocks: parseSong(s.body || "")
    };
  }

  let songs = [];
  function buildSongs() {
    const mine = loadUserSongs().map(function (s) {
      return {
        title: s.title, artist: s.artist, key: s.key,
        capo: s.capo, body: s.body, custom: true
      };
    });
    songs = (window.SONGS || []).concat(mine).map(makeSong);
  }
  buildSongs();

  let current = -1;
  let fontSize = store.get("fontSize", 27);
  let dark = store.get("dark", true);
  let scrolling = false;
  let scrollSpeed = store.get("scrollSpeed", 3);
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
  const overlayEl = $("chordOverlay");
  const overlayBody = $("chordOverlayBody");

  // ---- Library rendering ---------------------------------------------------
  function renderLibrary(filter) {
    songListEl.innerHTML = "";
    const f = (filter || "").trim().toLowerCase();
    let shown = 0;
    songs.forEach(function (song) {
      if (f && (song.title + " " + song.artist).toLowerCase().indexOf(f) === -1) return;
      shown++;
      const row = document.createElement("div");
      row.className = "song-row";
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
      row.appendChild(card);
      if (song.custom) {
        const del = document.createElement("button");
        del.className = "song-del";
        del.textContent = "✕";
        del.setAttribute("aria-label", "Remove " + song.title);
        del.addEventListener("click", function (e) {
          e.stopPropagation();
          if (!window.confirm("Remove “" + song.title + "” from your songbook?")) return;
          saveUserSongs(loadUserSongs().filter(function (s) {
            return (s.title + "|" + s.artist).toLowerCase() !== song.id;
          }));
          buildSongs();
          renderLibrary(searchEl.value);
        });
        row.appendChild(del);
      }
      songListEl.appendChild(row);
    });
    if (shown === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = songs.length === 0
        ? "No songs yet. Add them in songs.js."
        : "No songs match your search.";
      songListEl.appendChild(empty);
    }
    const countEl = $("count");
    if (countEl) {
      const mine = songs.filter(function (s) { return s.custom; }).length;
      countEl.textContent = songs.length + " songs" + (mine ? " · " + mine + " yours" : "");
    }
  }

  // ---- Song rendering ------------------------------------------------------
  function transposeFor(song) { return store.get("t:" + song.id, 0); }
  function setTransposeFor(song, val) { store.set("t:" + song.id, val); }

  function transposeKey(key, steps) {
    if (!key) return "";
    const m = key.match(/^([A-G][#b]?)(.*)$/);
    if (!m) return key;
    const minor = /m/.test(m[2]) ? "m" : "";
    const useFlats = FLAT_KEYS.has(key);
    return transposeChord(m[1], steps, useFlats) + minor;
  }

  function renderSong() {
    const song = songs[current];
    if (!song) return;
    const steps = transposeFor(song);
    const shownKey = transposeKey(song.key, steps);
    const useFlats = FLAT_KEYS.has(shownKey) || (steps === 0 && FLAT_KEYS.has(song.key));

    titleEl.textContent = song.title;
    let meta = song.artist || "";
    if (shownKey) meta += (meta ? "  ·  " : "") + "Key " + shownKey;
    if (song.capo) meta += "  ·  Capo " + song.capo;
    metaEl.textContent = meta;
    transposeLabel.textContent = steps === 0 ? "0" : (steps > 0 ? "+" + steps : "" + steps);

    renderBlocks(sheetEl, song.blocks, steps, useFlats);
  }

  function renderBlocks(container, blocks, steps, useFlats) {
    container.innerHTML = "";
    blocks.forEach(function (b) {
      if (b.type === "space") {
        const d = document.createElement("div"); d.className = "spacer";
        container.appendChild(d); return;
      }
      if (b.type === "label") {
        const d = document.createElement("div"); d.className = "section-label";
        d.textContent = b.text; container.appendChild(d); return;
      }
      const lineEl = document.createElement("div");
      lineEl.className = "line";
      b.cells.forEach(function (cell) {
        const pair = document.createElement("span");
        pair.className = "pair";
        const chord = document.createElement("span");
        chord.className = "chord";
        if (cell.chord) {
          const name = transposeChord(cell.chord, steps, useFlats);
          chord.textContent = name;
          chord.dataset.chord = name;
          chord.setAttribute("role", "button");
        }
        const lyric = document.createElement("span");
        lyric.className = "lyric";
        lyric.textContent = cell.text.length ? cell.text : "";
        pair.appendChild(chord);
        pair.appendChild(lyric);
        lineEl.appendChild(pair);
      });
      container.appendChild(lineEl);
    });
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
    stopScroll(); closeChord();
    current = -1;
    viewerEl.classList.add("hidden");
    libraryEl.classList.remove("hidden");
  }
  function nextSong() { if (current >= 0 && current < songs.length - 1) openSong(current + 1); }
  function prevSong() { if (current > 0) openSong(current - 1); }

  // ---- Transpose -----------------------------------------------------------
  function bumpTranspose(delta) {
    const song = songs[current]; if (!song) return;
    let t = transposeFor(song) + delta;
    if (t > 11) t = 11; if (t < -11) t = -11;
    setTransposeFor(song, t);
    renderSong();
  }

  // ---- Font ----------------------------------------------------------------
  function applyFont() {
    document.documentElement.style.setProperty("--sheet-font", fontSize + "px");
  }
  function bumpFont(delta) {
    fontSize = Math.max(14, Math.min(56, fontSize + delta));
    store.set("fontSize", fontSize);
    applyFont();
  }

  // ---- Paging (tap) --------------------------------------------------------
  function pageBy(dir) {
    const amount = Math.max(60, sheetEl.clientHeight * 0.82) * dir;
    sheetEl.scrollBy({ top: amount, behavior: "smooth" });
  }

  // ---- Auto-scroll ---------------------------------------------------------
  function tick() {
    if (!scrolling) return;
    scrollAccum += scrollSpeed * 0.18;
    if (scrollAccum >= 1) {
      const whole = Math.floor(scrollAccum);
      sheetEl.scrollTop += whole;
      scrollAccum -= whole;
    }
    if (sheetEl.scrollTop + sheetEl.clientHeight >= sheetEl.scrollHeight - 1) { stopScroll(); return; }
    rafId = requestAnimationFrame(tick);
  }
  function startScroll() {
    if (scrolling) return;
    scrolling = true; scrollAccum = 0;
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

  // ---- Chord diagram overlay ----------------------------------------------
  function openChord(name) {
    overlayBody.innerHTML =
      '<div class="chord-name"></div>' +
      (window.chordDiagramSVG ? window.chordDiagramSVG(name) : "");
    overlayBody.querySelector(".chord-name").textContent = name;
    overlayEl.classList.add("show");
  }
  function closeChord() { overlayEl.classList.remove("show"); }

  // ---- Import --------------------------------------------------------------
  function impEl(id) { return $(id); }

  function openImport() {
    ["impTitle", "impArtist", "impKey", "impText"].forEach(function (id) {
      impEl(id).value = "";
    });
    impEl("impCapo").value = "";
    impEl("impPreview").innerHTML = "";
    impEl("impHint").textContent =
      "Paste a chart — chords above lyrics, or ChordPro. Nothing leaves this device.";
    $("importOverlay").classList.add("show");
    impEl("impText").focus();
  }
  function closeImport() { $("importOverlay").classList.remove("show"); }

  // Pull "Title - Artist" off the top of a pasted chart, if it's there.
  function guessMeta(text) {
    const first = (text.split("\n")[0] || "").trim();
    const m = first.match(/^(.{1,60}?)\s+[-–—]\s+(.{1,60})$/);
    if (!m) return null;
    if (isChordLine(first) || sectionName(first)) return null;
    return { title: m[1].trim(), artist: m[2].trim() };
  }

  // If the first line was read as "Title - Artist", it isn't part of the chart.
  function bodyFromPaste(text) {
    let t = text;
    if (guessMeta(t)) t = t.split("\n").slice(1).join("\n");
    return importToBody(t);
  }

  function refreshImportPreview() {
    const raw = impEl("impText").value;
    const body = bodyFromPaste(raw);
    const blocks = parseSong(body);
    const key = impEl("impKey").value.trim();
    renderBlocks(impEl("impPreview"), blocks, 0, FLAT_KEYS.has(key));
    const lines = blocks.filter(function (b) { return b.type === "line"; }).length;
    const chords = body.match(/\[[^\]]+\]/g);
    impEl("impHint").textContent = raw.trim()
      ? lines + " lines · " + (chords ? chords.length : 0) + " chords · " +
        (looksLikeChordPro(raw) ? "ChordPro" : "chords-above-lyrics") + " detected"
      : "Paste a chart — chords above lyrics, or ChordPro. Nothing leaves this device.";
  }

  function saveImport() {
    const title = impEl("impTitle").value.trim();
    const body = bodyFromPaste(impEl("impText").value);
    if (!title) { impEl("impHint").textContent = "Give it a title first."; return; }
    if (!body) { impEl("impHint").textContent = "Nothing to import — paste a chart."; return; }
    const entry = {
      title: title,
      artist: impEl("impArtist").value.trim(),
      key: impEl("impKey").value.trim(),
      capo: parseInt(impEl("impCapo").value, 10) || 0,
      body: body
    };
    const id = (entry.title + "|" + entry.artist).toLowerCase();
    const list = loadUserSongs().filter(function (s) {
      return (s.title + "|" + s.artist).toLowerCase() !== id;
    });
    list.push(entry);
    saveUserSongs(list);
    buildSongs();
    closeImport();
    renderLibrary("");
    searchEl.value = "";
    const added = songs.findIndex(function (s) { return s.id === id; });
    if (added >= 0) openSong(added);
  }

  // Export your imported songs as a songs.js-ready snippet.
  function exportMine() {
    const mine = loadUserSongs();
    if (!mine.length) { impEl("impHint").textContent = "No imported songs yet."; return; }
    const text = mine.map(function (s) {
      return "  {\n" +
        "    title: " + JSON.stringify(s.title) + ",\n" +
        "    artist: " + JSON.stringify(s.artist || "") + ",\n" +
        "    key: " + JSON.stringify(s.key || "") + ",\n" +
        "    capo: " + (s.capo || 0) + ",\n" +
        "    body: `" + String(s.body).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`\n" +
        "  }";
    }).join(",\n");
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-songs.txt";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    impEl("impHint").textContent = "Exported " + mine.length + " song(s).";
  }

  // ---- Theme ---------------------------------------------------------------
  function applyTheme() { document.documentElement.classList.toggle("light", !dark); }

  // ---- Init ----------------------------------------------------------------
  function init() {
    applyTheme();
    applyFont();
    speedInput.value = scrollSpeed;

    $("backBtn").addEventListener("click", backToLibrary);
    $("prevBtn").addEventListener("click", prevSong);
    $("nextBtn").addEventListener("click", nextSong);
    $("transDown").addEventListener("click", function () { bumpTranspose(-1); });
    $("transUp").addEventListener("click", function () { bumpTranspose(1); });
    $("fontDown").addEventListener("click", function () { bumpFont(-3); });
    $("fontUp").addEventListener("click", function () { bumpFont(3); });
    $("themeBtn").addEventListener("click", function () {
      dark = !dark; store.set("dark", dark); applyTheme();
    });

    playBtn.addEventListener("click", toggleScroll);
    speedInput.addEventListener("input", function () {
      scrollSpeed = parseInt(speedInput.value, 10);
      store.set("scrollSpeed", scrollSpeed);
    });

    // Sheet tap: chord -> diagram; else page (or pause auto-scroll)
    sheetEl.addEventListener("click", function (e) {
      const chordEl = e.target.closest(".chord");
      if (chordEl && chordEl.dataset.chord) {
        openChord(chordEl.dataset.chord);
        return;
      }
      if (scrolling) { stopScroll(); return; }
      const rect = sheetEl.getBoundingClientRect();
      const rel = (e.clientY - rect.top) / rect.height;
      pageBy(rel < 0.22 ? -1 : 1);
    });

    // Overlay: tap anywhere to close
    overlayEl.addEventListener("click", closeChord);

    searchEl.addEventListener("input", function () { renderLibrary(searchEl.value); });

    // Import
    $("importBtn").addEventListener("click", openImport);
    $("importClose").addEventListener("click", closeImport);
    $("impSave").addEventListener("click", saveImport);
    $("impExport").addEventListener("click", exportMine);
    $("impKey").addEventListener("input", refreshImportPreview);
    impEl("impText").addEventListener("input", function () {
      const g = !impEl("impTitle").value.trim() && guessMeta(impEl("impText").value);
      if (g) { impEl("impTitle").value = g.title; impEl("impArtist").value = g.artist; }
      refreshImportPreview();
    });
    $("importOverlay").addEventListener("click", function (e) {
      if (e.target === $("importOverlay")) closeImport();
    });

    // Swipe left/right to change songs
    let sx = 0, sy = 0, tracking = false;
    sheetEl.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    sheetEl.addEventListener("touchend", function (e) {
      if (!tracking) return; tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) {
        if (dx < 0) nextSong(); else prevSong();
      }
    }, { passive: true });

    document.addEventListener("keydown", function (e) {
      // While importing, keep the keyboard to the form.
      if ($("importOverlay").classList.contains("show")) {
        if (e.key === "Escape") closeImport();
        return;
      }
      if (overlayEl.classList.contains("show")) { closeChord(); return; }
      if (current < 0) return;
      if (e.key === "ArrowRight") nextSong();
      else if (e.key === "ArrowLeft") prevSong();
      else if (e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); pageBy(1); }
      else if (e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); pageBy(-1); }
      else if (e.key === " ") { e.preventDefault(); toggleScroll(); }
      else if (e.key === "Escape") backToLibrary();
    });

    renderLibrary("");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
