#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build data.js from the transcription in source/.

Devanagari is the source of truth; IAST is generated from it, never typed by
hand, so the two can never drift apart. Every Devanagari codepoint in the
input must be known to the transliterator - an unknown one is a hard error,
not a silent drop. Run:  python3 build_data.py
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "source"))

import notes_part1 as p1  # noqa: E402
import notes_part2 as p2  # noqa: E402

# ------------------------------------------------------------------ IAST

VOWELS = {
    'अ': 'a', 'आ': 'ā', 'इ': 'i', 'ई': 'ī', 'उ': 'u', 'ऊ': 'ū',
    'ऋ': 'ṛ', 'ॠ': 'ṝ', 'ऌ': 'ḷ', 'ॡ': 'ḹ',
    'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
    'ऍ': 'ê', 'ऎ': 'e', 'ऑ': 'ô', 'ऒ': 'o',
}

MATRAS = {
    'ा': 'ā', 'ि': 'i', 'ी': 'ī', 'ु': 'u', 'ू': 'ū',
    'ृ': 'ṛ', 'ॄ': 'ṝ', 'ॢ': 'ḷ', 'ॣ': 'ḹ',
    'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
    'ॅ': 'ê', 'ॆ': 'e', 'ॉ': 'ô', 'ॊ': 'o',
}

CONSONANTS = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ṅ',
    'च': 'c', 'छ': 'ch', 'ज': 'j', 'झ': 'jh', 'ञ': 'ñ',
    'ट': 'ṭ', 'ठ': 'ṭh', 'ड': 'ḍ', 'ढ': 'ḍh', 'ण': 'ṇ',
    'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n', 'ऩ': 'n',
    'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
    'य': 'y', 'र': 'r', 'ऱ': 'r', 'ल': 'l', 'ळ': 'ḷ', 'ऴ': 'ḻ',
    'व': 'v', 'श': 'ś', 'ष': 'ṣ', 'स': 's', 'ह': 'h',
    'क़': 'q', 'ख़': 'ḵh', 'ग़': 'ġ', 'ज़': 'z', 'ड़': 'ṛ', 'ढ़': 'ṛh', 'फ़': 'f', 'य़': 'y',
}

SIGNS = {
    'ं': 'ṃ', 'ः': 'ḥ', 'ँ': 'm̐', 'ऽ': "'",
    '॑': '', '॒': '',            # vedic accents, not used here
    'ॐ': 'oṃ',
    '।': '।', '॥': '॥',          # dandas pass through unchanged
    '॰': '॰',
}

DIGITS = {'०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
          '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'}

VIRAMA = '्'
ZWJ, ZWNJ = '‍', '‌'

# Codepoints that are Devanagari but deliberately carry no IAST of their own.
IGNORED = {ZWJ, ZWNJ, '​'}


def is_devanagari(ch):
    return 'ऀ' <= ch <= 'ॿ' or ch in (ZWJ, ZWNJ)


def to_iast(text):
    """Transliterate Devanagari to IAST. Raises on an unknown Devanagari char."""
    out = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]

        if ch in IGNORED:
            i += 1
            continue

        # consonant, possibly followed by matra / virama / nasal marks
        if ch in CONSONANTS:
            # nukta forms are stored precomposed above; also handle base+nukta
            base = ch
            if i + 1 < n and text[i + 1] == '़':
                combined = unicodedata.normalize('NFC', ch + '़')
                if combined in CONSONANTS:
                    base, i = combined, i + 1
                else:
                    i += 1  # bare nukta with no mapping: drop the mark
            out.append(CONSONANTS[base])
            i += 1
            # what follows the consonant decides the vowel
            if i < n and text[i] == VIRAMA:
                i += 1
                # skip a joiner used purely to force a conjunct form
                while i < n and text[i] in (ZWJ, ZWNJ):
                    i += 1
                continue                      # bare consonant, no vowel
            if i < n and text[i] in MATRAS:
                out.append(MATRAS[text[i]])
                i += 1
            else:
                out.append('a')               # inherent vowel
            continue

        if ch in VOWELS:
            out.append(VOWELS[ch])
            i += 1
            continue

        if ch in MATRAS:
            # a matra with no consonant before it - keep it visible rather
            # than dropping it silently
            out.append(MATRAS[ch])
            i += 1
            continue

        if ch in SIGNS:
            out.append(SIGNS[ch])
            i += 1
            continue

        if ch in DIGITS:
            out.append(DIGITS[ch])
            i += 1
            continue

        if ch == VIRAMA:
            i += 1
            continue

        if is_devanagari(ch):
            raise ValueError(
                'unmapped Devanagari char %r (U+%04X) near: %s'
                % (ch, ord(ch), text[max(0, i - 25):i + 25])
            )

        out.append(ch)   # latin, punctuation, whitespace pass through
        i += 1

    return ''.join(out)


# ------------------------------------------------------- kuta redaction

# The three kutas of the Pancadasi. Kept in the data because Om Swami
# published them himself on os.me, but the app masks them until the reader
# asks. Longest first so the matcher never splits one inside another.
KUTAS = ['हसकहलह्रीं', 'कएइलह्रीं', 'सकलह्रीं']


def count_kutas(text):
    return sum(text.count(k) for k in KUTAS)


# ------------------------------------------------------------ assembly

def tr(s):
    """Devanagari string -> {d, i} pair."""
    return {'d': s, 'i': to_iast(s)}


def tr_lines(lines):
    return [tr(l) for l in lines]


def build():
    data = {}

    # --- steps
    data['steps'] = {
        'title': p1.PAGE_1_2_STEPS['title'],
        'groups': [
            {
                'heading': tr(g['heading']) if g['heading'] else None,
                'items': [{'n': n, **tr(t)} for n, t in g['items']],
            }
            for g in p1.PAGE_1_2_STEPS['groups']
        ],
    }

    # --- routine
    r = p1.PAGE_3_ROUTINE
    data['routine'] = {
        'title': tr(r['title']),
        'titleEn': r['title_en'],
        'sections': [{'name': tr(a), 'pages': b} for a, b in r['sections']],
        'counts': [
            {'name': tr(a), 'value': tr(b), 'en': c, 'num': d}
            for a, b, c, d in r['counts']
        ],
        'days': tr(r['days']),
        'signed': tr(r['signed']),
    }

    # --- viniyoga
    data['viniyoga'] = {
        'heading': tr(p1.VINIYOGA['heading']),
        'lines': tr_lines(p1.VINIYOGA['lines']),
    }

    # --- nyasas
    nyasas = []
    for ny in p1.NYASAS:
        entry = {
            'id': ny['id'],
            'heading': tr(ny['heading']),
            'lines': tr_lines(ny['lines']),
        }
        if 'table' in ny:
            entry['table'] = {
                'note': tr(ny['table']['note']),
                'rows': [
                    {'key': tr(k), 'cells': [tr(c) for c in cells]}
                    for k, cells in ny['table']['rows']
                ],
            }
        if 'colophon' in ny:
            entry['colophon'] = tr(ny['colophon'])
        nyasas.append(entry)
    data['nyasas'] = nyasas

    # --- page 8 blocks
    data['preliminaries'] = [
        {'id': 'mudra', 'heading': tr(p1.MUDRA['heading']),
         'lines': tr_lines(p1.MUDRA['lines'])},
        {'id': 'peethadevata', 'heading': tr(p1.PEETHA_DEVATA['heading']),
         'lines': tr_lines(p1.PEETHA_DEVATA['lines'])},
        {'id': 'peethashakti', 'heading': tr(p1.PEETHA_SHAKTI['heading']),
         'lines': tr_lines(p1.PEETHA_SHAKTI['lines'])},
        {'id': 'yantrasana', 'heading': tr(p1.YANTRASANA['heading']),
         'lines': tr_lines(p1.YANTRASANA['lines'])},
        {'id': 'ajna', 'heading': tr(p1.AVARANA_AJNA['heading']),
         'lines': tr_lines(p1.AVARANA_AJNA['lines'])},
    ]

    # --- puja vidhi
    pv = p2.PUJA_VIDHI
    data['pujaVidhi'] = {
        'heading': tr(pv['heading']),
        'headingIast': pv['heading_iast'],
        'steps': [
            {
                'n': s['n'],
                'name': tr(s['name']),
                'mudra': tr(s['mudra']),
                'verse': tr_lines(s['verse']),
                'seal': tr(s['seal']),
            }
            for s in pv['steps']
        ],
        'prarthana': {
            'heading': tr(pv['prarthana']['heading']),
            'verse': tr_lines(pv['prarthana']['verse']),
            'seal': tr(pv['prarthana']['seal']),
            'mudras': tr(pv['prarthana']['mudras']),
        },
    }

    # --- shodashopachara
    data['shodashopachara'] = {
        'heading': tr(p2.SHODASHOPACHARA['heading']),
        'items': [
            {'n': n, 'name': tr(name), 'verse': tr(verse), 'seal': tr(seal)}
            for n, name, verse, seal in p2.SHODASHOPACHARA['items']
        ],
    }

    # --- avarana puja
    ap = p2.AVARANA_PUJA
    data['avarana'] = {
        'heading': tr(ap['heading']),
        'opening': tr(ap['opening']),
        'groups': [
            {
                'id': g['id'],
                'heading': tr(g['heading']),
                'chakra': g['chakra'],
                'diagram': g['diagram'],
                'sub': g.get('sub', False),
                'items': [{'n': n, **tr(t)} for n, t in g['items']],
                'closing': tr_lines(g.get('closing', [])),
            }
            for g in ap['groups']
        ],
    }

    data['sheets'] = [
        {'file': f + '.png', 'title': t} for f, t in p2.SHEETS
    ]
    data['acknowledgement'] = p2.ACKNOWLEDGEMENT
    data['kutas'] = KUTAS

    return data


# ------------------------------------------------------------- checking

def collect_strings(obj, acc):
    if isinstance(obj, dict):
        for v in obj.values():
            collect_strings(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            collect_strings(v, acc)
    elif isinstance(obj, str):
        acc.append(obj)


def verify(data):
    """Every Devanagari string must have produced a non-empty IAST, and no
    Devanagari must survive into an IAST field."""
    problems = []
    dev_re = re.compile(r'[ऀ-ॿ]')

    def walk(o, path=''):
        if isinstance(o, dict):
            if 'd' in o and 'i' in o and isinstance(o['d'], str):
                d, i = o['d'], o['i']
                if d.strip() and not i.strip():
                    problems.append(f'{path}: empty IAST for {d!r}')
                # dandas are the only Devanagari allowed through to IAST
                leftover = dev_re.sub(
                    '', i.replace('।', '').replace('॥', '').replace('॰', ''))
                if dev_re.search(i.replace('।', '').replace('॥', '').replace('॰', '')):
                    problems.append(f'{path}: Devanagari left in IAST: {i!r}')
                del leftover
            for k, v in o.items():
                walk(v, f'{path}/{k}')
        elif isinstance(o, list):
            for n, v in enumerate(o):
                walk(v, f'{path}[{n}]')

    walk(data)
    return problems


def build_yantra():
    """Trim sri-yantra.json down to the one variant the app draws.

    The full file carries two solutions (huet and traditional) plus the 74
    cells and the verification block. Only `traditional` is drawn here, and
    only the parts the renderer touches, which takes 53 KB to about 14 KB.
    """
    src = json.loads((Path(__file__).parent / 'sri-yantra.json').read_text('utf-8'))
    v = src['variants']['traditional']
    out = {
        'triangles': [{'points': t['points']} for t in v['triangles']],
        'yantra_triangles': [
            {'points': t['points'], 'avarana': t['avarana'], 'ring': t['ring']}
            for t in v['yantra_triangles']
        ],
        'bindu': v['bindu'],
        'layout': v['layout'],
        'avaranas': v['avaranas'],
        'about': src['about'],
    }
    assert len(out['triangles']) == 9
    assert len(out['yantra_triangles']) == 43
    path = Path(__file__).parent / 'yantra-data.js'
    path.write_text(
        '// Generated by build_data.py from sri-yantra.json - do not edit.\n'
        '// ' + src['about'].replace('\n', ' ')[:150] + '\n'
        'window.YANTRA_DATA = '
        + json.dumps(out, separators=(',', ':')) + ';\n',
        encoding='utf-8',
    )
    return path, len(out['yantra_triangles'])


def main():
    data = build()

    problems = verify(data)
    if problems:
        for p in problems[:20]:
            print('FAIL', p)
        sys.exit(1)

    # counts, printed so a change to the source is visible in the diff
    all_strings = []
    collect_strings(data, all_strings)
    dev_chars = sum(1 for s in all_strings for c in s if is_devanagari(c))
    kuta_total = sum(count_kutas(s) for s in all_strings)
    n_avarana_items = sum(len(g['items']) for g in data['avarana']['groups'])
    n_steps = sum(len(g['items']) for g in data['steps']['groups'])

    print(f'nyasas              {len(data["nyasas"])}')
    print(f'daily steps         {n_steps}')
    print(f'puja vidhi steps    {len(data["pujaVidhi"]["steps"])}')
    print(f'upacharas           {len(data["shodashopachara"]["items"])}')
    print(f'avarana groups      {len(data["avarana"]["groups"])}')
    print(f'avarana items       {n_avarana_items}')
    print(f'sheets              {len(data["sheets"])}')
    print(f'devanagari chars    {dev_chars}')
    print(f'kuta occurrences    {kuta_total}  (masked by default in the UI)')

    assert n_steps == 41, n_steps
    assert n_avarana_items == 123, n_avarana_items
    assert len(data['nyasas']) == 15
    assert len(data['shodashopachara']['items']) == 16
    assert len(data['sheets']) == 16

    # Offerings are reached through the Sri Chakra, so every group must name a
    # region the figure actually has. A key the renderer does not know makes
    # its offerings silently unreachable - which is exactly what 'trikona'
    # (the geometry name) did before it became 'sarvasiddhiprada'.
    known = {r['name'] for r in
             json.loads((Path(__file__).parent / 'sri-yantra.json')
                        .read_text('utf-8'))['variants']['traditional']['avaranas']}
    used = {g['chakra'] for g in data['avarana']['groups']}
    unknown = used - known
    assert not unknown, f'avarana groups point at unknown chakra regions: {unknown}'

    # and every numbered offering must be reachable from some region
    reachable = sum(len(g['items']) for g in data['avarana']['groups']
                    if g['chakra'] in known)
    assert reachable == 123, f'only {reachable} of 123 offerings are on a known region'
    print(f'chakra regions      {len(used)} used, all known, all 123 reachable')

    # every diagram the app asks for must exist
    for g in data['avarana']['groups']:
        names = ['av2a', 'av2b', 'av2c'] if g['id'] == 'av2' else [g['id']]
        for n in names:
            p = Path(__file__).parent / 'diagrams' / (n + '.png')
            assert p.exists(), f'missing diagram {p.name} for {g["id"]}'
    for s in data['sheets']:
        p = Path(__file__).parent / 'sheets' / s['file']
        assert p.exists(), f'missing sheet {s["file"]}'
    print('assets              all diagrams and sheets present')

    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    out = Path(__file__).parent / 'data.js'
    out.write_text(
        '// Generated by build_data.py - do not edit by hand.\n'
        '// Source: https://os.me/srividya (Om Swami, Sri Vidya Sadhana Notes).\n'
        'window.SRIVIDYA_DATA = ' + payload + ';\n',
        encoding='utf-8',
    )
    print(f'\nwrote {out} ({out.stat().st_size:,} bytes)')

    ypath, ntri = build_yantra()
    print(f'wrote {ypath} ({ypath.stat().st_size:,} bytes, {ntri} cells)')


if __name__ == '__main__':
    main()
