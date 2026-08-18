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

  /* Keep in step with CACHE in sw.js. Shown in the library header so the
     running version is a fact you can read, not something to guess at — and
     so a stale service worker shows up as a mismatch instead of silently
     serving old code. */
  const APP_VERSION = "v21";

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

  // Chord-diagram graphics in exported PDFs often come through as runs of
  // mis-encoded glyphs (CJK and similar). They're never chart content.
  function isGlyphJunk(line) {
    const chars = line.replace(/\s/g, "");
    if (chars.length < 2) return false;
    let odd = 0;
    for (let i = 0; i < chars.length; i++) {
      if (chars.charCodeAt(i) > 0x2100) odd++;
    }
    return odd / chars.length > 0.5;
  }

  function chartToChordPro(text) {
    const src = text.replace(/\r\n/g, "\n").replace(/\t/g, "    ").split("\n");
    const out = [];
    for (let i = 0; i < src.length; i++) {
      const line = src[i];
      if (isGlyphJunk(line)) continue;
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

  // ---- Working out a song's key from its chords ----------------------------
  // Split a chord name into pitch class + rough quality. Extensions (7, sus,
  // add9…) don't change which key a chord belongs to, so they're ignored.
  function chordParts(name) {
    const m = String(name).split("/")[0].match(/^([A-G][#b]?)(.*)$/);
    if (!m) return null;
    const pc = noteIndex(m[1]);
    if (pc < 0) return null;
    const tail = m[2];
    let q = "maj";
    if (/^(dim|°|o\b)/i.test(tail)) q = "dim";
    else if (/^m(?!aj)/.test(tail)) q = "min";
    return { pc: pc, q: q };
  }

  // Scale degrees and qualities of the seven diatonic triads.
  const MAJOR_TRIADS = [[0,"maj"],[2,"min"],[4,"min"],[5,"maj"],[7,"maj"],[9,"min"],[11,"dim"]];
  // Natural minor, plus the major V that harmonic minor borrows — extremely
  // common in practice, so a song using it shouldn't be pushed off its key.
  const MINOR_TRIADS = [[0,"min"],[2,"dim"],[3,"maj"],[5,"min"],[7,"min"],[8,"maj"],[10,"maj"],[7,"maj"]];

  function guessKeyFromChords(names) {
    const counts = {};
    let first = null, last = null, total = 0;
    names.forEach(function (n) {
      const p = chordParts(n);
      if (!p) return;
      const id = p.pc + ":" + p.q;
      counts[id] = (counts[id] || 0) + 1;
      if (!first) first = p;
      last = p;
      total++;
    });
    if (total < 3) return "";

    let best = null;
    for (let root = 0; root < 12; root++) {
      [["maj", MAJOR_TRIADS], ["min", MINOR_TRIADS]].forEach(function (pair) {
        const mode = pair[0], triads = pair[1];
        const allowed = {};
        triads.forEach(function (t) { allowed[((root + t[0]) % 12) + ":" + t[1]] = true; });
        let score = 0;
        Object.keys(counts).forEach(function (id) {
          if (allowed[id]) score += counts[id];
        });
        // A song usually starts and ends on its tonic — worth a nudge, but not
        // enough to override the chords actually used. The opening chord is
        // weighted higher: charts often stop mid-progression, so the last
        // chord is the less reliable of the two. Checked against the built-in
        // songs' declared keys, this scores 8/8 where favouring the final
        // chord scores 7/8, and either signal alone does worse than both.
        const tonic = root + ":" + (mode === "maj" ? "maj" : "min");
        if (first && first.pc + ":" + first.q === tonic) score += 1.5;
        if (last && last.pc + ":" + last.q === tonic) score += 1;
        if (!best || score > best.score) best = { root: root, mode: mode, score: score };
      });
    }
    if (!best || best.score / total < 0.7) return ""; // too ambiguous to claim
    const name = (best.mode === "min" ? FLAT : SHARP)[best.root];
    const label = name + (best.mode === "min" ? "m" : "");
    return FLAT_KEYS.has(label) ? FLAT[best.root] + (best.mode === "min" ? "m" : "") : label;
  }

  // ---- Reading a chart's header --------------------------------------------
  // Pulls title / artist / key / capo off the top of a chart and reports which
  // lines were used, so they can be dropped from the body.
  function extractMeta(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const meta = { title: "", artist: "", key: "", capo: "" };
    const used = {};
    const limit = Math.min(lines.length, 15);

    for (let i = 0; i < limit; i++) {
      const raw = lines[i];
      const L = raw.trim();
      if (!L || isChordLine(raw) || sectionName(raw)) continue;
      let m;
      if (!meta.title && (m = L.match(/^(?:title|song)\s*[:\-–]\s*(.+)$/i))) {
        meta.title = m[1].trim(); used[i] = 1; continue;
      }
      if (!meta.artist && (m = L.match(/^(?:artist|band|performed\s+by|written\s+by)\s*[:\-–]?\s*(.+)$/i))) {
        meta.artist = m[1].trim(); used[i] = 1; continue;
      }
      // Chart sites head the page "<Title> Chords by <Artist>" (Ultimate
      // Guitar and friends). Take both halves and drop the line.
      if (i < 4 && (m = L.match(/^(.{1,70}?)\s+(?:chords|tabs?|lyrics)?\s*by\s+(.{2,50})$/i))) {
        if (!meta.title) meta.title = m[1].replace(/\s+(chords|tabs?|lyrics)$/i, "").trim();
        if (!meta.artist) meta.artist = m[2].trim();
        used[i] = 1; continue;
      }
      // A bare "by X" only counts right at the top, where it can't be a lyric.
      if (!meta.artist && i < 4 && (m = L.match(/^by\s+(.{2,50})$/i))) {
        meta.artist = m[1].trim(); used[i] = 1; continue;
      }
      // Header fields we don't use, but which shouldn't end up in the chart.
      if (/^(difficulty|tuning|author|strumming|subscribe|rating|views)\s*[:\-–]/i.test(L)) {
        used[i] = 1; continue;
      }
      if (/^(chords|tab|lyrics|chord\s+diagrams?)$/i.test(L)) { used[i] = 1; continue; }
      if (!meta.key && (m = L.match(/^key\s*(?:of\s*)?[:\-–]?\s*([A-G][#b]?)\s*(m|min|minor|maj|major)?\b/i))) {
        // "bb" -> "Bb", "f#" -> "F#": note letter upper, accidental lower.
        meta.key = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
        if (m[2] && /^m(in(or)?)?$/i.test(m[2])) meta.key += "m";
        used[i] = 1; continue;
      }
      if (!meta.capo && /^(no\s+capo|capo\s*[:\-–]?\s*(none|0|off))$/i.test(L)) {
        meta.capo = "0"; used[i] = 1; continue;
      }
      if (!meta.capo && (m = L.match(/^capo\s*(?:on\s*|at\s*)?(?:fret\s*)?[:\-–]?\s*(\d{1,2})/i))) {
        meta.capo = m[1]; used[i] = 1; continue;
      }
    }

    // "Title - Artist" on the first line of the chart.
    if (!meta.title || !meta.artist) {
      for (let i = 0; i < Math.min(lines.length, 3); i++) {
        if (used[i]) continue;
        const L = lines[i].trim();
        if (!L || isChordLine(lines[i]) || sectionName(lines[i])) continue;
        const m = L.match(/^(.{1,60}?)\s+[-–—]\s+(.{1,60})$/);
        if (m) {
          if (!meta.title) meta.title = m[1].trim();
          if (!meta.artist) meta.artist = m[2].trim();
          used[i] = 1;
        }
        break;
      }
    }

    const body = lines.filter(function (_, i) { return !used[i]; }).join("\n").trim();
    return { meta: meta, body: body };
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

  // Built-in songs live in songs.js, which is part of the repo — deleting one
  // hides it on this device rather than editing the file, so it stays
  // recoverable and a rebuild never resurrects it silently.
  function loadHidden() {
    const list = store.get("hiddenSongs", []);
    return Array.isArray(list) ? list : [];
  }
  function saveHidden(list) { store.set("hiddenSongs", list); }

  // "Deleted for good": still only a list, because songs.js ships with the
  // app and a browser can't edit it. The difference from hidden is that these
  // are no longer offered back in the hidden panel — the song is gone from
  // the interface on this device rather than parked.
  function loadPurged() {
    const list = store.get("purgedSongs", []);
    return Array.isArray(list) ? list : [];
  }
  function savePurged(list) { store.set("purgedSongs", list); }

  function songKey(s) { return ((s.title || "") + "|" + (s.artist || "")).toLowerCase(); }

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
    const hidden = loadHidden().concat(loadPurged());
    const mine = loadUserSongs().map(function (s) {
      return {
        title: s.title, artist: s.artist, key: s.key,
        capo: s.capo, body: s.body, custom: true
      };
    });
    // Filter before mapping so song.index still matches its slot in songs[].
    const visible = (window.SONGS || []).concat(mine)
      .filter(function (s) { return hidden.indexOf(songKey(s)) === -1; });

    // Your own version of a song replaces the built-in of the same name rather
    // than sitting next to it. Imported songs come last, so the last entry for
    // a given title|artist wins.
    const winner = {};
    visible.forEach(function (s) { winner[songKey(s)] = s; });
    songs = visible
      .filter(function (s) { return winner[songKey(s)] === s; })
      .map(makeSong);
  }
  buildSongs();

  let capoFilter = store.get("capoFilter", "all");   // "all" | "yes" | "no"
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
      if (capoFilter === "yes" && !song.capo) return;
      if (capoFilter === "no" && song.capo) return;
      shown++;
      const row = document.createElement("div");
      row.className = "song-row";
      const card = document.createElement("button");
      card.className = "song-card";
      card.innerHTML =
        '<span class="song-card-title"></span>' +
        '<span class="song-card-artist"></span>' +
        '<span class="song-card-meta">' +
          '<span class="song-card-key"></span>' +
          '<span class="song-card-capo"></span>' +
        '</span>';
      card.querySelector(".song-card-title").textContent = song.title;
      card.querySelector(".song-card-artist").textContent = song.artist;
      card.querySelector(".song-card-key").textContent = song.key ? "Key " + song.key : "";
      const capoEl = card.querySelector(".song-card-capo");
      if (song.capo) {
        capoEl.textContent = "Capo " + song.capo;
      } else {
        capoEl.classList.add("hidden");
      }
      card.addEventListener("click", function () { openSong(song.index); });
      row.appendChild(card);
      const del = document.createElement("button");
      del.className = "song-del";
      del.textContent = "✕";
      del.setAttribute("aria-label", "Remove " + song.title);
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        const msg = song.custom
          ? "Delete “" + song.title + "”? It was imported on this device, so this can't be undone."
          : "Remove “" + song.title + "” from your songbook? You can restore it later.";
        if (!window.confirm(msg)) return;
        if (song.custom) {
          saveUserSongs(loadUserSongs().filter(function (s) {
            return songKey(s) !== song.id;
          }));
        } else {
          const hidden = loadHidden();
          if (hidden.indexOf(song.id) === -1) hidden.push(song.id);
          saveHidden(hidden);
        }
        buildSongs();
        renderLibrary(searchEl.value);
      });
      row.appendChild(del);
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
      const filtering = capoFilter !== "all" || !!f;
      countEl.textContent = filtering
        ? shown + " of " + songs.length + " songs"
        : songs.length + " songs" + (mine ? " · " + mine + " yours" : "");
    }
    document.querySelectorAll(".chip[data-capo]").forEach(function (c) {
      c.classList.toggle("on", c.dataset.capo === capoFilter);
    });
    const restoreEl = $("restoreBtn");
    if (restoreEl) {
      const n = loadHidden().length;
      restoreEl.textContent = "Hidden (" + n + ")";
      restoreEl.title = "Show hidden songs";
      restoreEl.classList.toggle("hidden", n === 0);
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
      // A chord that falls part-way through a word splits it across two pairs,
      // and the line wraps between pairs — so on a narrow screen the word
      // itself breaks in half. Split each cell into runs of word and
      // whitespace, then bundle everything up to and including a space into a
      // group that can't break internally. Wrapping then happens only at
      // spaces, however many chords land inside a word.
      const tokens = [];
      b.cells.forEach(function (cell) {
        const parts = cell.text.match(/\s+|\S+/g);
        if (!parts) {
          tokens.push({ chord: cell.chord, text: "", isSpace: false });
          return;
        }
        parts.forEach(function (p, i) {
          tokens.push({
            chord: i === 0 ? cell.chord : "",
            text: p,
            isSpace: /^\s/.test(p)
          });
        });
      });

      let group = null;
      tokens.forEach(function (cell) {
        if (!group) {
          group = document.createElement("span");
          group.className = "wordgroup";
          lineEl.appendChild(group);
        }
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
        group.appendChild(pair);
        // The space ends the word, so the next group may start a new line.
        if (cell.isSpace) group = null;
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

  // ---- Reading files -------------------------------------------------------
  // pdf.js is ~320KB, so it's only pulled in the first time a PDF is opened.
  // The service worker caches it at runtime, so it still works offline after.
  let pdfLibPromise = null;
  function loadPdfLib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfLibPromise) return pdfLibPromise;
    pdfLibPromise = new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = "vendor/pdf.min.js";
      s.onload = function () {
        if (!window.pdfjsLib) { reject(new Error("pdf.js failed to load")); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error("pdf.js failed to load")); };
      document.head.appendChild(s);
    });
    return pdfLibPromise;
  }

  // A PDF has no notion of "lines" — just glyphs at x/y. Chord charts live or
  // die by column alignment, so rebuild rows from y and columns from x rather
  // than taking the naive concatenation of the text items.
  function itemsToLines(items) {
    const rows = [];
    items.forEach(function (it) {
      // Drop whitespace-only items and let geometry decide the spacing below.
      // Their text can't be trusted: charts routinely carry blank items barely
      // 1 unit wide against a ~4.8 unit character — sub-pixel positioning
      // nudges, not spaces — and emitting a space for each one splits words
      // down the middle. Their x positions still account for any real gap, so
      // nothing is lost by ignoring them here.
      if (!it.str || !it.str.trim()) return;
      const x = it.transform[4];
      const y = it.transform[5];
      let row = null;
      for (let i = 0; i < rows.length; i++) {
        if (Math.abs(rows[i].y - y) <= 2.5) { row = rows[i]; break; }
      }
      if (!row) { row = { y: y, items: [] }; rows.push(row); }
      row.items.push({ x: x, str: it.str, w: it.width || 0 });
    });
    if (!rows.length) return [];

    // Character grid for turning an x position into a column. Use the MEDIAN
    // per-character width, not the mean: proportional fonts throw out extreme
    // outliers (this varies ~23x on real charts) and a mean is dragged badly
    // off by them.
    const perChar = [];
    let minX = Infinity;
    rows.forEach(function (r) {
      r.items.forEach(function (i) {
        if (!i.str.trim()) return;          // blanks skew both measures
        if (i.w > 0) perChar.push(i.w / i.str.length);
        if (i.x < minX) minX = i.x;
      });
    });
    perChar.sort(function (a, b) { return a - b; });
    const charW = perChar.length ? perChar[Math.floor(perChar.length / 2)] : 5;
    if (minX === Infinity) minX = 0;

    // Padding is only for genuine positional jumps — an indent, or the gap
    // between chords on a chord row. Runs that merely sit next to each other
    // are one word and must be joined with nothing at all. Tuned by counting
    // stranded single letters in lyric rows (chord rows excluded, since "G"
    // and "D" are real chords there): 0.9 gave the fewest splits with no
    // words jammed together, across two different charts.
    const spaceGap = charW * 0.9;

    rows.sort(function (a, b) { return b.y - a.y; }); // PDF y grows upward
    return rows.map(function (r) {
      r.items.sort(function (a, b) { return a.x - b.x; });
      let line = "";
      let prevEnd = null;
      r.items.forEach(function (i) {
        if (prevEnd === null) {
          const col = Math.max(0, Math.round((i.x - minX) / charW));
          if (col > line.length) line += new Array(col - line.length + 1).join(" ");
        } else if (i.x - prevEnd > spaceGap) {
          // Real gap: hold the column if we can, but always leave one space.
          const col = Math.max(0, Math.round((i.x - minX) / charW));
          const target = Math.max(col, line.length + 1);
          line += new Array(target - line.length + 1).join(" ");
        }
        // else: continuation of the same word — append with no separator.
        line += i.str;
        prevEnd = i.x + (i.w || 0);
      });
      return line.replace(/\s+$/, "");
    });
  }

  function readPdf(file) {
    return loadPdfLib().then(function (pdfjsLib) {
      return file.arrayBuffer();
    }).then(function (buf) {
      return window.pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (doc) {
      const pages = [];
      let chain = Promise.resolve();
      for (let p = 1; p <= doc.numPages; p++) {
        (function (num) {
          chain = chain.then(function () {
            return doc.getPage(num)
              .then(function (page) { return page.getTextContent(); })
              .then(function (tc) { pages.push(itemsToLines(tc.items).join("\n")); });
          });
        })(p);
      }
      return chain.then(function () { return pages.join("\n\n"); });
    });
  }

  // Remembered so that pressing "Add to songbook" after a failed read repeats
  // the real reason instead of replacing it with a generic "nothing to import".
  let lastFileProblem = "";

  function setHint(msg, isProblem) {
    impEl("impHint").textContent = msg;
    impEl("impHint").classList.toggle("problem", !!isProblem);
  }

  function readDroppedFile(file) {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    lastFileProblem = "";
    setHint("Reading " + file.name + "…", false);
    const job = isPdf ? readPdf(file) : file.text();
    return job.then(function (text) {
      if (isPdf && text.replace(/\s/g, "").length < 40) {
        lastFileProblem =
          "“" + file.name + "” is a scan — the pages are images, with no text " +
          "to pull out. Nothing can be imported from it. Use a text-based PDF, " +
          "or paste/type the chart into the box above.";
        setHint(lastFileProblem, true);
        return;
      }
      impEl("impText").value = text;
      autoFillMeta(text);
      // Last resort for the title: the file's own name. Without this, a chart
      // whose header doesn't name the song — or whose header you trimmed off —
      // leaves Title empty, and saving then refuses with only a small hint.
      const titleEl = impEl("impTitle");
      if (titleEl && !titleEl.value.trim()) {
        titleEl.value = file.name
          .replace(/\.[a-z0-9]+$/i, "")
          .replace(/[_-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      refreshImportPreview();
    }).catch(function (err) {
      lastFileProblem = "Couldn't read “" + file.name + "”: " +
        (err && err.message ? err.message : err);
      setHint(lastFileProblem, true);
    });
  }

  // ---- Trimming the pasted chart -------------------------------------------
  // Charts arrive wrapped in site furniture — headers, footers, "printed from"
  // lines. Most of it is at the top or the bottom, so cutting a line at a time
  // from either end clears it faster than selecting text in a small box.
  const editHistory = [];

  function pushEditHistory() {
    editHistory.push(impEl("impText").value);
    if (editHistory.length > 50) editHistory.shift();
    $("impUndo").disabled = false;
  }

  function undoEdit() {
    if (!editHistory.length) return;
    impEl("impText").value = editHistory.pop();
    $("impUndo").disabled = editHistory.length === 0;
    refreshImportPreview();
  }

  // Drop the first (or last) line that actually has something on it, along
  // with any blank lines outside it.
  function trimEnd(fromTop) {
    const lines = impEl("impText").value.split("\n");
    let i = fromTop ? 0 : lines.length - 1;
    const step = fromTop ? 1 : -1;
    while (i >= 0 && i < lines.length && !lines[i].trim()) i += step;
    if (i < 0 || i >= lines.length) return;      // nothing left to cut
    pushEditHistory();
    lines.splice(i, 1);
    // Tidy away blanks now stranded at that end.
    while (lines.length && !lines[fromTop ? 0 : lines.length - 1].trim()) {
      lines.splice(fromTop ? 0 : lines.length - 1, 1);
    }
    impEl("impText").value = lines.join("\n");
    refreshImportPreview();
  }

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

  // Header lines that were read as metadata aren't part of the chart.
  function bodyFromPaste(text) {
    return importToBody(extractMeta(text).body);
  }

  // Fill in whatever the chart tells us, without overwriting anything already
  // typed — a value the user entered by hand always wins.
  function autoFillMeta(text) {
    const found = extractMeta(text).meta;
    ["title", "artist", "key", "capo"].forEach(function (f) {
      const el = impEl("imp" + f.charAt(0).toUpperCase() + f.slice(1));
      if (el && !el.value.trim() && found[f]) el.value = found[f];
    });
    // Say "None" rather than leaving the box empty: a blank capo reads as
    // "not filled in yet", when in practice a chart that never mentions a
    // capo is a chart you play without one.
    const capoEl = impEl("impCapo");
    if (capoEl && (!capoEl.value.trim() || capoEl.value.trim() === "0")) {
      capoEl.value = "None";
    }
    // No stated key? Infer one from the chords actually used.
    const keyEl = impEl("impKey");
    if (keyEl && !keyEl.value.trim()) {
      const body = importToBody(extractMeta(text).body);
      const names = (body.match(/\[([^\]]+)\]/g) || []).map(function (t) {
        return t.slice(1, -1);
      });
      const guess = guessKeyFromChords(names);
      if (guess) keyEl.value = guess;
    }
  }

  function refreshImportPreview() {
    const raw = impEl("impText").value;
    const body = bodyFromPaste(raw);
    const blocks = parseSong(body);
    const key = impEl("impKey").value.trim();
    renderBlocks(impEl("impPreview"), blocks, 0, FLAT_KEYS.has(key));
    const lines = blocks.filter(function (b) { return b.type === "line"; }).length;
    const chords = body.match(/\[[^\]]+\]/g);
    if (raw.trim()) lastFileProblem = ""; // they've typed something, so move on
    setHint(raw.trim()
      ? lines + " lines · " + (chords ? chords.length : 0) + " chords · " +
        (looksLikeChordPro(raw) ? "ChordPro" : "chords-above-lyrics") + " detected"
      : (lastFileProblem ||
         "Paste a chart — chords above lyrics, or ChordPro. Nothing leaves this device."),
      !raw.trim() && !!lastFileProblem);
  }

  function saveImport() {
    const title = impEl("impTitle").value.trim();
    const body = bodyFromPaste(impEl("impText").value);
    if (!title) {
      // Point at the box that's blocking, rather than only writing a hint
      // under the chart where it's easy to miss.
      setHint("Give it a title first — the Title box is empty.", true);
      const el = impEl("impTitle");
      el.classList.add("needed");
      el.focus();
      setTimeout(function () { el.classList.remove("needed"); }, 2000);
      return;
    }
    if (!body) {
      // Don't bury the reason a file failed behind a generic message.
      setHint(lastFileProblem || "Nothing to import — paste a chart.", true);
      return;
    }
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
    // Importing a song is an explicit request for it, so it has to override an
    // earlier hide or delete of the same title. Without this the song saves
    // correctly and is then filtered straight back out by buildSongs(), which
    // looks like the import silently did nothing.
    saveHidden(loadHidden().filter(function (h) { return h !== id; }));
    savePurged(loadPurged().filter(function (h) { return h !== id; }));
    buildSongs();
    closeImport();
    renderLibrary("");
    searchEl.value = "";
    const added = songs.findIndex(function (s) { return s.id === id; });
    if (added >= 0) openSong(added);
  }

  // ---- Backup / restore ----------------------------------------------------
  // A whole-songbook file you can move between devices by AirDrop, email, or
  // a cloud folder. Local storage is per-device, so this is the only way an
  // imported song reaches your phone without going through the repo.
  const BACKUP_FORMAT = "songbook";
  const BACKUP_VERSION = 1;

  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function exportBackup() {
    const mine = loadUserSongs();
    const hidden = loadHidden();
    const purged = loadPurged();
    if (!mine.length && !hidden.length && !purged.length) {
      impEl("impHint").textContent = "Nothing to back up yet — no imported songs.";
      return;
    }
    const payload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exported: new Date().toISOString(),
      songs: mine,
      hidden: hidden,
      purged: purged
    };
    const stamp = payload.exported.slice(0, 10);
    download("songbook-" + stamp + ".json", JSON.stringify(payload, null, 2), "application/json");
    impEl("impHint").textContent =
      "Backed up " + mine.length + " song(s)" +
      (hidden.length ? " and " + hidden.length + " hidden" : "") +
      ". Open this file on your other device and hit Restore.";
  }

  function restoreBackup(file) {
    return file.text().then(function (text) {
      let data;
      try { data = JSON.parse(text); }
      catch (e) { throw new Error("that isn't a valid backup file"); }
      if (!data || data.format !== BACKUP_FORMAT || !Array.isArray(data.songs)) {
        throw new Error("that isn't a songbook backup");
      }
      if (data.version > BACKUP_VERSION) {
        throw new Error("that backup was made by a newer version of the app");
      }
      // Merge rather than replace, so restoring never silently drops songs
      // that only exist on this device.
      const existing = loadUserSongs();
      const byKey = {};
      existing.forEach(function (s) { byKey[songKey(s)] = s; });
      let added = 0, updated = 0;
      data.songs.forEach(function (s) {
        if (!s || !s.title) return;
        const entry = {
          title: s.title,
          artist: s.artist || "",
          key: s.key || "",
          capo: s.capo || 0,
          body: s.body || ""
        };
        if (byKey[songKey(entry)]) updated++; else added++;
        byKey[songKey(entry)] = entry;
      });
      const merged = Object.keys(byKey).map(function (k) { return byKey[k]; });
      saveUserSongs(merged);

      if (Array.isArray(data.hidden)) {
        const hidden = loadHidden();
        data.hidden.forEach(function (id) {
          if (typeof id === "string" && hidden.indexOf(id) === -1) hidden.push(id);
        });
        saveHidden(hidden);
      }
      if (Array.isArray(data.purged)) {
        const purged = loadPurged();
        data.purged.forEach(function (id) {
          if (typeof id === "string" && purged.indexOf(id) === -1) purged.push(id);
        });
        savePurged(purged);
      }
      buildSongs();
      renderLibrary("");
      searchEl.value = "";
      impEl("impHint").textContent =
        "Restored: " + added + " added, " + updated + " updated.";
    }).catch(function (err) {
      impEl("impHint").textContent = "Couldn't restore: " + (err && err.message ? err.message : err);
    });
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

  // ---- Hidden songs --------------------------------------------------------
  // Deleting a built-in only hides it, since songs.js ships with the app. This
  // panel is where those live, so hiding one stays reversible per song rather
  // than being an all-or-nothing restore.
  function hiddenSongsList() {
    return loadHidden().map(function (id) {
      let src = null;
      (window.SONGS || []).forEach(function (s) {
        if (!src && songKey(s) === id) src = s;
      });
      const parts = id.split("|");
      return {
        id: id,
        title: src ? src.title : (parts[0] || id),
        artist: src ? (src.artist || "") : (parts[1] || "")
      };
    });
  }

  function unhide(id) {
    saveHidden(loadHidden().filter(function (h) { return h !== id; }));
    buildSongs();
    renderLibrary(searchEl.value);
    renderHiddenList();
  }

  function renderHiddenList() {
    const listEl = $("hiddenList");
    const noteEl = $("hiddenNote");
    if (!listEl) return;
    const items = hiddenSongsList();
    listEl.innerHTML = "";
    noteEl.textContent = items.length
      ? "These are hidden on this device only. The songs themselves ship with the app, so restoring one always brings it back."
      : "Nothing is hidden.";
    $("hiddenRestoreAll").disabled = items.length === 0;
    items.forEach(function (it) {
      const row = document.createElement("div");
      row.className = "hidden-row";
      const label = document.createElement("div");
      label.className = "hidden-row-label";
      const t = document.createElement("span");
      t.className = "hidden-row-title";
      t.textContent = it.title;
      const a = document.createElement("span");
      a.className = "hidden-row-artist";
      a.textContent = it.artist;
      label.appendChild(t);
      label.appendChild(a);
      const btn = document.createElement("button");
      btn.className = "btn mini";
      btn.textContent = "Restore";
      btn.addEventListener("click", function () { unhide(it.id); });
      const del = document.createElement("button");
      del.className = "btn mini danger";
      del.textContent = "Delete";
      del.addEventListener("click", function () {
        if (!window.confirm(
          "Delete “" + it.title + "” for good?\n\n" +
          "It stays out of your songbook and won't be listed here again, " +
          "so there'll be no way to bring it back from this screen."
        )) return;
        saveHidden(loadHidden().filter(function (h) { return h !== it.id; }));
        const purged = loadPurged();
        if (purged.indexOf(it.id) === -1) purged.push(it.id);
        savePurged(purged);
        buildSongs();
        renderLibrary(searchEl.value);
        renderHiddenList();
      });
      row.appendChild(label);
      row.appendChild(btn);
      row.appendChild(del);
      listEl.appendChild(row);
    });
    if (!items.length) closeHidden();
  }

  function openHidden() {
    renderHiddenList();
    $("hiddenOverlay").classList.add("show");
  }
  function closeHidden() { $("hiddenOverlay").classList.remove("show"); }

  // ---- Version badge -------------------------------------------------------
  // Reports the version of the code that's actually running, and — by asking
  // the service worker which cache it's serving from — flags the case where
  // the two have drifted apart.
  function askWorkerVersion() {
    return new Promise(function (resolve) {
      if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
        resolve(null); return;
      }
      const timer = setTimeout(function () { resolve(null); }, 1500);
      function onMsg(e) {
        if (e.data && e.data.type === "version") {
          clearTimeout(timer);
          navigator.serviceWorker.removeEventListener("message", onMsg);
          resolve(String(e.data.cache || "").replace(/^songbook-/, ""));
        }
      }
      navigator.serviceWorker.addEventListener("message", onMsg);
      navigator.serviceWorker.controller.postMessage("version");
    });
  }

  function refreshVersionBadge() {
    const el = $("versionBadge");
    if (!el) return;
    el.textContent = APP_VERSION;
    el.classList.remove("stale");
    el.title = "Tap to check for updates";
    askWorkerVersion().then(function (cacheVer) {
      if (cacheVer && cacheVer !== APP_VERSION) {
        el.textContent = APP_VERSION + " → " + cacheVer;
        el.classList.add("stale");
        el.title = "Running " + APP_VERSION + " but cache is " + cacheVer + ". Tap to update.";
      }
    });
  }

  // Everything I had to do by hand all session, in one button: re-check the
  // worker, bypass the HTTP cache for the core files, then reload.
  function forceUpdate() {
    const el = $("versionBadge");
    if (el) el.textContent = "updating…";
    const steps = [];
    if ("serviceWorker" in navigator) {
      steps.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.map(function (r) { return r.update().catch(function () {}); }));
      }).catch(function () {}));
    }
    steps.push(Promise.all(
      ["index.html", "app.js", "styles.css", "songs.js", "chords.js", "sw.js"].map(function (f) {
        return fetch(f, { cache: "reload" }).catch(function () {});
      })
    ));
    Promise.all(steps).then(function () {
      setTimeout(function () { location.reload(); }, 250);
    });
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

    document.querySelectorAll(".chip[data-capo]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        capoFilter = chip.dataset.capo;
        store.set("capoFilter", capoFilter);
        renderLibrary(searchEl.value);
      });
    });

    $("versionBadge").addEventListener("click", forceUpdate);
    refreshVersionBadge();

    $("restoreBtn").addEventListener("click", openHidden);
    $("hiddenClose").addEventListener("click", closeHidden);
    $("hiddenRestoreAll").addEventListener("click", function () {
      saveHidden([]);
      buildSongs();
      renderLibrary(searchEl.value);
      renderHiddenList();
    });
    $("hiddenOverlay").addEventListener("click", function (e) {
      if (e.target === $("hiddenOverlay")) closeHidden();
    });

    // Import
    $("importBtn").addEventListener("click", openImport);
    $("importClose").addEventListener("click", closeImport);
    $("impSave").addEventListener("click", saveImport);
    $("impExport").addEventListener("click", exportMine);
    $("impTrimTop").addEventListener("click", function () { trimEnd(true); });
    $("impTrimBottom").addEventListener("click", function () { trimEnd(false); });
    $("impUndo").addEventListener("click", undoEdit);
    $("impBackup").addEventListener("click", exportBackup);
    $("impRestore").addEventListener("click", function () { $("impBackupFile").click(); });
    $("impBackupFile").addEventListener("change", function (e) {
      const input = e.target;
      const f = input.files && input.files[0];
      if (!f) return;
      // Same trap as the chart file input: clearing the input before the async
      // read finishes can release the file on iOS WebKit, so the restore
      // silently does nothing. Clear it once the read has settled.
      restoreBackup(f).then(function () { input.value = ""; },
                            function () { input.value = ""; });
    });
    $("impKey").addEventListener("input", refreshImportPreview);

    // File picker + drag-and-drop onto the paste box
    $("impFileBtn").addEventListener("click", function () { $("impFile").click(); });
    $("impFile").addEventListener("change", function (e) {
      const input = e.target;
      const f = input.files && input.files[0];
      if (!f) return;
      $("impFileName").textContent = f.name;
      // Clear the input only once the read has finished. Doing it straight
      // away can release the underlying file on iOS WebKit while the async
      // read is still in flight, which fails silently with an empty result.
      readDroppedFile(f).then(function () { input.value = ""; },
                              function () { input.value = ""; });
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      impEl("impText").addEventListener(ev, function (e) {
        e.preventDefault(); impEl("impText").classList.add("dropping");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      impEl("impText").addEventListener(ev, function () {
        impEl("impText").classList.remove("dropping");
      });
    });
    impEl("impText").addEventListener("drop", function (e) {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      $("impFileName").textContent = f.name;
      readDroppedFile(f);
    });
    impEl("impText").addEventListener("input", function () {
      autoFillMeta(impEl("impText").value);
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
