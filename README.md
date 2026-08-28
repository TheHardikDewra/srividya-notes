# Sri Vidya Sadhana Notes

An interactive reading of **Om Swami's own Pañcadaśī Śrī Vidyā sādhana notes**,
handwritten in December 2010 for the sādhana that began that January and
published by him at **[os.me/srividya](https://os.me/srividya)**.

Live: **[panchadashi.vercel.app](https://panchadashi.vercel.app)**

Everything here comes from that page. Nothing is added, interpreted, or
supplied from elsewhere.

---

## What it does

| View | What's in it |
|---|---|
| **Home** | The vow — 15 lakh japa, 1.5 lakh yajña, 15,000 tarpaṇa, 1,500 mārjana, 150 brāhmaṇa bhoja, over 150 days |
| **Chakra** | The Śrī Chakra as an index. Tap a ring, get its āvaraṇa, its offerings, and Om Swami's own diagram |
| **Krama** | The 41 steps of one sitting, tickable, clearing itself each day |
| **Text** | Everything — viniyoga, 15 nyāsas, pīṭha pūjā, the pūjā vidhi, Ṣoḍaśopacāra on the Śrī Sūkta, all 9 āvaraṇas. Devanāgarī / IAST / both, and search |
| **Sheets** | The 16 original sheets and the Śrī Yantra he drew and did the sādhana on |
| **Practice** | Japa toward 15,00,000 and days toward 150, synced across devices if you sign in |

## The mantra

The notes carry the three **kūṭas** of the Pañcadaśī inside the nyāsa lines —
39 occurrences. The app masks every one of them by default and reveals them
only when the reader asks.

Om Swami published them himself, so nothing is hidden here that he has not
already opened. But a mantra of this order is received by **dīkṣā from a living
Guru**, not picked up from a web page, and the app says so where it matters.

The mask is presentational only: `data.js` holds the text exactly as printed,
and `app.js` decides how it is painted.

---

## Why the text was transcribed by hand

The typed PDF on os.me has a **broken text layer**. Its embedded Word subset
font (`___WRD_EMBED_SUB_1239`) carries a ToUnicode CMap that maps each
width-variant of the i-mātrā glyph to a different wrong codepoint:

| Rendered correctly | What the text layer says |
|---|---|
| क्लीं | तलीं |
| त्रिपुर | द्धत्रपुर |
| शिरसि | शशरशस |
| कनिष्ठ | कतनष्ठ |
| दक्षिणा | दक्षक्षणा |

`pdftotext`, `pypdf` and `mutool` all reproduce it identically, because the
fault is in the file, not the reader. The *rendered glyphs* are correct, so
every line in `source/` was read off `pdftoppm -r 200` renders of the 21 pages.

Source spellings are kept exactly as printed, including where the typed PDF
differs from classical orthography (`आसान न्यास` for आसन, `बिजाय` for बीजाय,
`पंचावृति` in the index against `पंचावृत्ति` in the body). This is a record of
Om Swami's notes, not an emended edition.

**IAST is generated, never typed.** `build_data.py` transliterates the
Devanāgarī, so the two can't drift. An unmapped Devanāgarī codepoint is a hard
build error rather than a silent drop.

## The Śrī Chakra

The figure is not decorative. It is the exact solution from the
[sri-yantra](https://github.com/TheHardikDewra/sri-yantra) project — the nine
triangles solved from the Chiodo (2021) / Huet concurrency conditions, worst
residual ~1e-61, cutting 43 cells in the canonical 1 / 8 / 10 / 10 / 14
enclosure counts.

Each āvaraṇa is placed on the ring **the notes themselves name**, in the
Sanskrit line that closes it:

> अत्र सर्वाशापरिपूरके **षोडशदलचक्रे** श्री महात्रिपुरसुन्दरी समधिष्ठते…

so the mapping is read off the source rather than assumed.

**What the app deliberately does not do:** it does not place the 123 individual
deities at individual seats. Om Swami's own diagrams do not use one consistent
direction — the sixteen-petal lotus is numbered anticlockwise from the bottom,
the eight-petal clockwise from the top — and guessing a convention would put
wrong seats in front of someone doing the sādhana. Instead each āvaraṇa shows
**his diagram**, cropped from the page it appears on.

---

## Build

```bash
python3 build_data.py     # source/*.py  ->  data.js + yantra-data.js
```

The build asserts what it produced: 41 steps, 15 nyāsas, 16 upacāras, 123
āvaraṇa offerings across 13 groups, 16 sheets, every group pointing at a Śrī
Chakra region the renderer actually has, all 123 offerings reachable from the
figure, and every diagram and sheet file present on disk.

No bundler, no framework, no build step for the app itself — open `index.html`.

```
index.html          shell and the six views
style.css           flat colour only; no gradients, no glows
app.js              rendering, masking, search, krama, practice
yantra.js           Sri Chakra renderer with addressable enclosures
data.js             generated - the text
yantra-data.js      generated - the geometry
sync.js             shared across all the sadhana apps, byte-identical
firebase-config.js  which localStorage keys sync, and how they merge
source/             the transcription, in Python literals
sheets/             the 16 original sheets + the Sri Yantra
diagrams/           the 15 avarana diagrams, cropped from the PDF pages
```

## Sync

Optional. Sign in and japa counts and completed days merge across devices;
every merge is union/max, commutative and idempotent, so nothing is ever lost
to a sync. Today's krama checklist and the kūṭa reveal switch stay local by
design — a sitting happens on a device, not on an account.

Shares the one Firebase project (`sadhana-apps-hd`, Spark free tier) with
lalita-sahasranama, lalita-trishati, shodashi-ashtottara, shri-rudram,
vishnu-sahasranama-stotram and bala-sadhana, so one login works across all of
them.

## Credits

- **Om Swami** — the notes, the sādhana, and the Śrī Yantra
- **Denish Patel** — typed and digitised the original handwriting
- [os.me/srividya](https://os.me/srividya) — where all of it is published

Not a substitute for dīkṣā.
