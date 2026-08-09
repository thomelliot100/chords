/*
 * Song library.
 *
 * Each song uses ChordPro format in the `body` field:
 *   - Put chords in [square brackets] right before the syllable they land on:
 *       [G]Amazing [G7]grace, how [C]sweet the [G]sound
 *   - {c: ...} or {comment: ...}  -> a grey section label (e.g. Chorus, Verse)
 *   - Blank lines create spacing between sections.
 *
 * To add a song, copy a { } block, paste a chord sheet into `body`, done.
 * The songs below are traditional / public-domain so the full words are included.
 */

const SONGS = [
  {
    title: "Amazing Grace",
    artist: "Traditional",
    key: "G",
    capo: 0,
    body: `{c: Verse 1}
[G]Amazing [G7]grace how [C]sweet the [G]sound
That [G]saved a [Em]wretch like [D]me
I [G]once was [G7]lost but [C]now am [G]found
Was [Em]blind but [D]now I [G]see

{c: Verse 2}
'Twas [G]grace that [G7]taught my [C]heart to [G]fear
And [G]grace my [Em]fears re[D]lieved
How [G]precious [G7]did that [C]grace ap[G]pear
The [Em]hour I [D]first be[G]lieved`
  },

  {
    title: "House of the Rising Sun",
    artist: "Traditional",
    key: "Am",
    capo: 0,
    body: `{c: Intro}
[Am] [C] [D] [F] [Am] [C] [E] [E]

{c: Verse 1}
There [Am]is a [C]house in [D]New Or[F]leans
They [Am]call the [C]Rising [E]Sun [E]
And it's [Am]been the [C]ruin of [D]many a poor [F]boy
And [Am]God I [E]know I'm [Am]one [C] [E]

{c: Verse 2}
My [Am]mother [C]was a [D]tailor [F]
She [Am]sewed my [C]new blue [E]jeans [E]
My [Am]father [C]was a [D]gamblin' [F]man
Down [Am]in New [E]Or[Am]leans [C] [E]`
  },

  {
    title: "Scarborough Fair",
    artist: "Traditional",
    key: "Am",
    capo: 0,
    body: `{c: Verse 1}
[Am]Are you going to [G]Scarborough [Am]Fair?
[C]Parsley, [D]sage, rose[Am]mary and [Am]thyme
Re[Am]member [G]me to one who [C]lives [G]there [Am]
[Am]She once [G]was a true love of [Am]mine

{c: Verse 2}
[Am]Tell her to make me a [G]cambric [Am]shirt
[C]Parsley, [D]sage, rose[Am]mary and [Am]thyme
With[Am]out no [G]seam nor [C]needle[G]work [Am]
[Am]Then she'll [G]be a true love of [Am]mine`
  },

  {
    title: "The Water Is Wide",
    artist: "Traditional",
    key: "D",
    capo: 0,
    body: `{c: Verse 1}
The [D]water [G]is [D]wide, I [G]can't cross [D]o'er
And [Bm]neither [Em]have I [A]wings to [A]fly
Give [D]me a [G]boat that can [D]carry [Bm]two
And [D]both shall [A]row, my [G]love and [D]I

{c: Verse 2}
There [D]is a [G]ship and [D]she sails the [G]sea [D]
She's [Bm]loaded [Em]deep as [A]deep can [A]be
But [D]not so [G]deep as the [D]love I'm [Bm]in
I [D]know not [A]how I [G]sink or [D]swim`
  },

  {
    title: "Wild Mountain Thyme",
    artist: "Traditional",
    key: "G",
    capo: 0,
    body: `{c: Verse}
Oh the [G]summer [C]time [G]has come
And the [C]trees are sweetly [G]bloomin'
And the [C]wild [G]mountain [Em]thyme
Grows a[C]round the bloomin' [G]heather
Will ye [C]go, [G]lassie [C]go?

{c: Chorus}
And we'll [G]all go to[C]gether to pull [G]wild mountain [Em]thyme
All a[C]round the bloomin' [G]heather
Will ye [C]go, [G]lassie [C]go?`
  },

  {
    title: "Down in the Valley",
    artist: "Traditional",
    key: "G",
    capo: 0,
    body: `{c: Verse 1}
[G]Down in the valley, the [D7]valley so low
[D7]Hang your head over, [G]hear the wind blow
[G]Hear the wind blow, dear, [D7]hear the wind blow
[D7]Hang your head over, [G]hear the wind blow

{c: Verse 2}
[G]Roses love sunshine, [D7]violets love dew
[D7]Angels in heaven, [G]know I love you
[G]Know I love you, dear, [D7]know I love you
[D7]Angels in heaven, [G]know I love you`
  },

  {
    title: "Dancing in the Dark",
    artist: "Bruce Springsteen",
    key: "G",
    capo: 4,
    body: `{c: Intro}
[G] [Em] [G] [Em]   (x2)

{c: Verse 1}
[G]I get up in the [Em]evening [G]
and I ain't got [Em]nothing to [G]say
I come home in the [Em]morning
I [G]go to bed [Em]feeling the same [C]way
I ain't nothing but [Am]tired [C]
Man, I'm just [Am]tired and bored with [G]myself
Hey there [Em]baby, [G] I could [Em]use just a little [D]help

{c: Chorus}
You [D]can't start a fire
You can't start a fire without a [C]spark
This gun's for [Am]hire [C]
Even if we're just [Am]dancing in the [G]dark

{c: Verse 2}
[G]Message keeps getting [Em]clearer [G]
Radio's on and I'm [Em]moving 'round the [G]place
I check my look in the [Em]mirror
I [G]wanna change my [Em]clothes, my hair, my [C]face
Man, I ain't getting [Am]nowhere [C]
I'm just [Am]living in a dump like [G]this
There's something happening [Em]somewhere [G]
Baby, I just [Em]know that there [D]is

{c: Chorus}
You [D]can't start a fire
You can't start a fire without a [C]spark
This gun's for [Am]hire [C]
Even if we're just [Am]dancing in the [G]dark

{c: Bridge}
[Em] You sit around getting [G]older
[C] There's a joke here some[D]where and it's on [Em]me
I'll shake this world off my [G]shoulders
[C] Come on baby, the [D]laugh's on me

{c: Verse 3}
[G]Stay on the streets of [Em]this town [G]
and they'll be [Em]carving you up [G]alright
They say you gotta stay [Em]hungry [G]
Hey baby, I'm [Em]just about starving [C]tonight
I'm dying for some [Am]action [C]
I'm sick of sitting 'round [Am]here trying to write this book [G]
I need a love [Em]reaction [G]
Come on now baby, [Em]gimme just one [D]look

{c: Chorus}
You [D]can't start a fire sitting 'round crying over a broken [C]heart
This gun's for [Am]hire [C]
Even if we're just [Am]dancing in the [D]dark
You [D]can't start a fire worrying about your little world falling [C]apart
This gun's for [Am]hire [C]
Even if we're just [Am]dancing in the [G]dark [C]

{c: Outro}
Even if we're just [Am]dancing in the [G]dark [C]   (x2)
[G]Hey baby`
  },

  {
    // Chord chart / arrangement. Paste your own lyric lines between the
    // chord lines if you want the words on screen too — see README.
    title: "Torn",
    artist: "Natalie Imbruglia",
    key: "F",
    capo: 0,
    body: `{c: Intro}
[F] [Fsus4] [F] [Fsus2]

{c: Verse 1}
[F] . . . | [Am] . . . | [Bb7] . . . |
[F] . . . | [Am] . . . | [Bb7] . . . |

{c: Pre-Chorus}
[Dm] . . . | [C] . . . | [Am] . . . | [C] . . [F] . |

{c: Chorus}
[C] . . . | [Dm] . . . | [Bb] . . . | [F] . . . |
[C] . . . | [Dm] . . . | [Bb] . . [F] . |
[C] . . . | [Dm] . [Bb] . |

{c: Verse 2}
[F] . . . | [Am] . . . | [Bb7] . . . |

{c: Pre-Chorus}
[Dm] . . . | [C] . . . | [Am] . . . | [C] . . [F] . |

{c: Chorus}
[C] . . . | [Dm] . . . | [Bb] . . . | [F] . . . |
[C] . . . | [Dm] . . . | [Bb] . . [F] . |
[C] . . . | [Dm] . [Bb] . |

{c: Pre-Chorus 2}
[Dm] [F] [C] | [Dm] . . . | [C] . . . | [Am] . . [C] . | [F] . . . |

{c: Chorus (x2)}
[C] . . . | [Dm] . . . | [Bb] . . . | [F] . . . |
[C] . . . | [Dm] . . . | [Bb] . . [F] . |
[C] . . . | [Dm] . [Bb] . |

{c: Outro}
[F] [C] [Dm] [Bb]   (x3)
[F] [C]`
  }
];

// Expose for the app.
window.SONGS = SONGS;
