# 🎸 Songbook

A landscape guitar chord/lyric app for playing & singing. Add it to your iPhone
home screen and it runs full-screen and offline.

## Features
- Chords sit directly above the lyric syllables
- **Transpose** up/down per song (remembers each song's setting)
- **Auto-scroll** with a speed slider — tap the sheet to pause
- **Swipe left/right** to move between songs (arrow keys on desktop)
- **A− / A+** text size, and a light/dark toggle
- Search the library; works offline once loaded

## Adding songs
All songs live in [`songs.js`](songs.js). Each one is a block like this:

```js
{
  title: "Song Title",
  artist: "Artist",
  key: "G",        // shown in the header; used to pick sharps vs flats
  capo: 0,         // shown in the header, e.g. Capo 2
  body: `
{c: Verse 1}
[G]Put chords in [C]brackets before the [D]syllable
[Em]They line up [C]automatically a[G]bove the words
`
}
```

Rules:
- `[Chord]` goes immediately before the syllable it lands on.
- `{c: ...}` (or `{comment: ...}`) makes a grey section label (Verse, Chorus…).
- Blank lines add spacing.
- For a chords-only line (intro/instrumental): `[Am] [C] [D] [F]`

That's the standard **ChordPro** format, so you can paste sheets from most
chord sites and they'll mostly work as-is.
