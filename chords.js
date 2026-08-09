/* ============================================================
   Chord fingering diagrams
   - CHORD_LIB: hand-tuned open/common shapes (nice to play)
   - movableShape(): barre-chord fallback for any root + quality
   - chordDiagramSVG(name): returns an <svg> string for a chord
   Fret arrays are low-E .. high-E:  -1 = muted (x), 0 = open.
   ============================================================ */

(function () {
  "use strict";

  const PC = { C:0, "C#":1, Db:1, D:2, "D#":3, Eb:3, E:4, F:5, "F#":6,
               Gb:6, G:7, "G#":8, Ab:8, A:9, "A#":10, Bb:10, B:11 };

  // Hand-picked common shapes. fr = frets, fg = fingers (0 = none/open).
  const CHORD_LIB = {
    // C family
    "C":     { fr:[-1,3,2,0,1,0], fg:[0,3,2,0,1,0] },
    "Cmaj7": { fr:[-1,3,2,0,0,0], fg:[0,3,2,0,0,0] },
    "C7":    { fr:[-1,3,2,3,1,0], fg:[0,3,2,4,1,0] },
    "Cadd9": { fr:[-1,3,2,0,3,0], fg:[0,2,1,0,3,0] },
    "Cm":    { fr:[-1,3,5,5,4,3], fg:[0,1,3,4,2,1], barre:{fret:3,from:5,to:1} },
    // D family
    "D":     { fr:[-1,-1,0,2,3,2], fg:[0,0,0,1,3,2] },
    "Dm":    { fr:[-1,-1,0,2,3,1], fg:[0,0,0,2,3,1] },
    "D7":    { fr:[-1,-1,0,2,1,2], fg:[0,0,0,3,1,2] },
    "Dm7":   { fr:[-1,-1,0,2,1,1], fg:[0,0,0,2,1,1] },
    "Dmaj7": { fr:[-1,-1,0,2,2,2], fg:[0,0,0,1,1,1] },
    "Dsus2": { fr:[-1,-1,0,2,3,0], fg:[0,0,0,1,2,0] },
    "Dsus4": { fr:[-1,-1,0,2,3,3], fg:[0,0,0,1,2,3] },
    // E family
    "E":     { fr:[0,2,2,1,0,0], fg:[0,2,3,1,0,0] },
    "Em":    { fr:[0,2,2,0,0,0], fg:[0,2,3,0,0,0] },
    "E7":    { fr:[0,2,0,1,0,0], fg:[0,2,0,1,0,0] },
    "Em7":   { fr:[0,2,0,0,0,0], fg:[0,2,0,0,0,0] },
    "Emaj7": { fr:[0,2,1,1,0,0], fg:[0,3,1,2,0,0] },
    // F family
    "F":     { fr:[1,3,3,2,1,1], fg:[1,3,4,2,1,1], barre:{fret:1,from:6,to:1} },
    "Fmaj7": { fr:[-1,-1,3,2,1,0], fg:[0,0,3,2,1,0] },
    "Fm":    { fr:[1,3,3,1,1,1], fg:[1,3,4,1,1,1], barre:{fret:1,from:6,to:1} },
    "F7":    { fr:[1,3,1,2,1,1], fg:[1,3,1,2,1,1], barre:{fret:1,from:6,to:1} },
    "Fsus2": { fr:[-1,-1,3,0,1,1], fg:[0,0,3,0,1,2] },
    "Fsus4": { fr:[1,3,3,3,1,1], fg:[1,2,3,4,1,1], barre:{fret:1,from:6,to:1} },
    // G family
    "G":     { fr:[3,2,0,0,0,3], fg:[3,1,0,0,0,4] },
    "G7":    { fr:[3,2,0,0,0,1], fg:[3,2,0,0,0,1] },
    "Gmaj7": { fr:[3,2,0,0,0,2], fg:[3,1,0,0,0,2] },
    "Gm":    { fr:[3,5,5,3,3,3], fg:[1,3,4,1,1,1], barre:{fret:3,from:6,to:1} },
    // A family
    "A":     { fr:[-1,0,2,2,2,0], fg:[0,0,1,2,3,0] },
    "Am":    { fr:[-1,0,2,2,1,0], fg:[0,0,2,3,1,0] },
    "A7":    { fr:[-1,0,2,0,2,0], fg:[0,0,2,0,3,0] },
    "Am7":   { fr:[-1,0,2,0,1,0], fg:[0,0,2,0,1,0] },
    "Amaj7": { fr:[-1,0,2,1,2,0], fg:[0,0,2,1,3,0] },
    "Asus2": { fr:[-1,0,2,2,0,0], fg:[0,0,1,2,0,0] },
    "Asus4": { fr:[-1,0,2,2,3,0], fg:[0,0,1,2,3,0] },
    // B family
    "B":     { fr:[-1,2,4,4,4,2], fg:[0,1,2,3,4,1], barre:{fret:2,from:5,to:1} },
    "Bm":    { fr:[-1,2,4,4,3,2], fg:[0,1,3,4,2,1], barre:{fret:2,from:5,to:1} },
    "B7":    { fr:[-1,2,1,2,0,2], fg:[0,2,1,3,0,4] },
    "Bm7":   { fr:[-1,2,4,2,3,2], fg:[0,1,3,1,2,1], barre:{fret:2,from:5,to:1} },
    // Common flats
    "Bb":    { fr:[-1,1,3,3,3,1], fg:[0,1,2,3,4,1], barre:{fret:1,from:5,to:1} },
    "Bbm":   { fr:[-1,1,3,3,2,1], fg:[0,1,3,4,2,1], barre:{fret:1,from:5,to:1} },
    "Bb7":   { fr:[-1,1,3,1,3,1], fg:[0,1,3,1,4,1], barre:{fret:1,from:5,to:1} },
    "Eb":    { fr:[-1,6,5,3,4,3], fg:[0,4,3,1,2,1] },
    "Ab":    { fr:[4,6,6,5,4,4], fg:[1,3,4,2,1,1], barre:{fret:4,from:6,to:1} }
  };

  // Movable barre shapes, as offsets from the barre fret.
  const E_SHAPE = { major:[0,2,2,1,0,0], minor:[0,2,2,0,0,0], "7":[0,2,0,1,0,0],
                    m7:[0,2,0,0,0,0], maj7:[0,2,1,1,0,0] };
  const A_SHAPE = { major:[-1,0,2,2,2,0], minor:[-1,0,2,2,1,0], "7":[-1,0,2,0,2,0],
                    m7:[-1,0,2,0,1,0], maj7:[-1,0,2,1,2,0] };

  function splitChord(name) {
    const m = String(name).match(/^([A-G][#b]?)(.*)$/);
    if (!m) return null;
    return { root: m[1], suffix: m[2] };
  }

  // Map a chord suffix to a movable-shape quality (best effort).
  function quality(suffix) {
    const s = suffix.trim();
    if (s === "" || s === "maj" || s === "M") return "major";
    if (s === "m" || s === "min" || s === "-") return "minor";
    if (s === "7" || s === "dom7") return "7";
    if (s === "m7" || s === "min7") return "m7";
    if (s === "maj7" || s === "M7" || s === "Δ7") return "maj7";
    return null; // unknown → no reliable movable shape
  }

  function movableShape(root, qual) {
    const pc = PC[root];
    if (pc === undefined) return null;
    // E-shape root sits on the low-E string (pc 4)
    let eFret = ((pc - 4) % 12 + 12) % 12; if (eFret === 0) eFret = 12;
    // A-shape root sits on the A string (pc 9)
    let aFret = ((pc - 9) % 12 + 12) % 12; if (aFret === 0) aFret = 12;

    const build = (base, offsets, barreFrom) => {
      const fr = offsets.map(o => (o < 0 ? -1 : base + o));
      return { fr, fg:null, barre:{ fret:base, from:barreFrom, to:1 } };
    };
    const eOK = E_SHAPE[qual], aOK = A_SHAPE[qual];
    if (!eOK && !aOK) return null;
    // Prefer whichever is lower on the neck (and playable, fret <= 11)
    const cands = [];
    if (eOK && eFret <= 11) cands.push({ base:eFret, offs:E_SHAPE[qual], from:6 });
    if (aOK && aFret <= 11) cands.push({ base:aFret, offs:A_SHAPE[qual], from:5 });
    if (!cands.length) return null;
    cands.sort((x, y) => x.base - y.base);
    const c = cands[0];
    return build(c.base, c.offs, c.from);
  }

  function getShape(name) {
    if (CHORD_LIB[name]) return CHORD_LIB[name];
    const parts = splitChord(name);
    if (!parts) return null;
    const q = quality(parts.suffix);
    if (!q) return null;
    return movableShape(parts.root, q);
  }

  // Build an SVG string for a chord shape.
  function chordDiagramSVG(name) {
    const shape = getShape(name);
    const W = 132, H = 168;
    const left = 20, right = W - 16, top = 40;
    const rows = 5;                 // fret rows shown
    const cols = 6;                 // strings
    const gx = (right - left) / (cols - 1);
    const bottom = H - 20;
    const gy = (bottom - top) / rows;

    if (!shape) {
      return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="chord-svg">
        <text x="${W/2}" y="${H/2}" text-anchor="middle" class="cd-noshape">no diagram</text>
      </svg>`;
    }

    const fretted = shape.fr.filter(f => f > 0);
    const maxF = fretted.length ? Math.max(...fretted) : 0;
    const minF = fretted.length ? Math.min(...fretted) : 0;
    let startFret = 1;
    if (maxF > 5) startFret = minF;                  // shift window up the neck
    const openNut = startFret === 1;

    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="chord-svg">`;
    // Strings (vertical)
    for (let c = 0; c < cols; c++) {
      const x = left + c * gx;
      s += `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" class="cd-line"/>`;
    }
    // Frets (horizontal)
    for (let r = 0; r <= rows; r++) {
      const y = top + r * gy;
      s += `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="cd-line${(r===0&&openNut)?" cd-nut":""}"/>`;
    }
    // Fret position label (e.g. "5fr") when not starting at the nut
    if (!openNut) {
      s += `<text x="${left - 8}" y="${top + gy*0.7}" text-anchor="end" class="cd-fretlabel">${startFret}fr</text>`;
    }
    // Barre
    if (shape.barre) {
      const b = shape.barre;
      const row = b.fret - startFret; // 0-based row index
      const y = top + (row + 0.5) * gy;
      const xFrom = left + (cols - b.from) * gx;
      const xTo = left + (cols - b.to) * gx;
      const x1 = Math.min(xFrom, xTo), x2 = Math.max(xFrom, xTo);
      s += `<rect x="${x1 - 6}" y="${y - 7}" width="${x2 - x1 + 12}" height="14" rx="7" class="cd-barre"/>`;
    }
    // Dots + open/muted markers
    for (let c = 0; c < cols; c++) {
      const x = left + c * gx;
      const f = shape.fr[c];
      if (f === -1) {
        s += `<text x="${x}" y="${top - 10}" text-anchor="middle" class="cd-x">×</text>`;
      } else if (f === 0) {
        s += `<circle cx="${x}" cy="${top - 15}" r="4.5" class="cd-open"/>`;
      } else {
        const row = f - startFret;
        const y = top + (row + 0.5) * gy;
        // skip drawing a separate dot if it's covered by the barre at its ends
        s += `<circle cx="${x}" cy="${y}" r="8" class="cd-dot"/>`;
        if (shape.fg && shape.fg[c]) {
          s += `<text x="${x}" y="${y + 3.5}" text-anchor="middle" class="cd-finger">${shape.fg[c]}</text>`;
        }
      }
    }
    s += `</svg>`;
    return s;
  }

  window.chordDiagramSVG = chordDiagramSVG;
  window.hasChordShape = function (name) { return !!getShape(name); };
})();
