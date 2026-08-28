/* ========================================
   Sri Vidya Sadhana Notes - app logic.

   Data comes from data.js (built from the transcription; Devanagari is the
   source of truth, IAST is generated). Geometry comes from yantra-data.js.
   Nothing here invents text: every string rendered traces back to os.me.
   ======================================== */

(function () {
  'use strict';

  var D = window.SRIVIDYA_DATA;
  var Y = window.YANTRA_DATA;

  /* ---------------------------------------------------------- storage */

  var KEY = {
    theme:    'sv_theme',
    script:   'sv_script',
    font:     'sv_font',
    krama:    'sv_krama',      // { date, done: [n] } - today only, not synced
    japa:     'sv_japa',       // { total, log: [{date,count}] }  merge: sadhana
    days:     'sv_days',       // ["2026-08-28", ...]             merge: idset
    kutas:    'sv_kutas'       // "1" once revealed, device-local by design
  };

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    if (window.SadhanaSync && window.SadhanaSync.push) window.SadhanaSync.push();
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function fmt(n) { return n.toLocaleString('en-IN'); }

  /* ------------------------------------------------------------- dom */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) {
      if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* --------------------------------------------------------- the kutas

     The three kutas of the Pancadasi are masked wherever they appear until
     the reader asks for them. The text itself is never altered - only how
     it is painted. One switch, remembered per device.
     ---------------------------------------------------------------- */

  var KUTAS = D.kutas.slice().sort(function (a, b) { return b.length - a.length; });
  var KUTA_IAST = { 'कएइलह्रीं': 'kaeilahrīṃ', 'हसकहलह्रीं': 'hasakahalahrīṃ', 'सकलह्रीं': 'sakalahrīṃ' };
  var kutaRe = new RegExp('(' + KUTAS.map(function (k) {
    return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('|') + ')', 'g');
  var iastRe = new RegExp('(' + Object.keys(KUTA_IAST).map(function (k) {
    return KUTA_IAST[k];
  }).join('|') + ')', 'g');

  var kutasShown = load(KEY.kutas, false);

  function maskDev(s) {
    return esc(s).replace(kutaRe, function (m) {
      return '<span class="kuta" data-k="' + esc(m) + '">' +
             (kutasShown ? esc(m) : '•••') + '</span>';
    });
  }
  function maskIast(s) {
    return esc(s).replace(iastRe, function (m) {
      return '<span class="kuta">' + (kutasShown ? esc(m) : '•••') + '</span>';
    });
  }

  function setKutas(on) {
    kutasShown = on;
    save(KEY.kutas, on);
    document.body.classList.toggle('kutas-shown', on);
    render();
    var btn = $('#reveal-all');
    if (btn) btn.textContent = on ? 'Hide kūṭas again' : 'Reveal kūṭas';
  }

  /* ------------------------------------------------------- script mode */

  var MODES = ['both', 'dev', 'iast'];
  var MODE_LABEL = { both: 'दे+IAST', dev: 'देवनागरी', iast: 'IAST' };
  var scriptMode = load(KEY.script, 'both');
  if (MODES.indexOf(scriptMode) < 0) scriptMode = 'both';

  // A {d,i} pair rendered per the current script mode.
  function pair(p, cls) {
    var out = [];
    if (scriptMode !== 'iast' && p.d.trim()) {
      out.push('<span class="dev ' + (cls || '') + '">' + maskDev(p.d) + '</span>');
    }
    if (scriptMode !== 'dev' && p.i.trim()) {
      out.push('<span class="iast ' + (cls || '') + '">' + maskIast(p.i) + '</span>');
    }
    return out.join('');
  }
  // Search runs against this, not against what is painted, so a line stays
  // findable whether or not its kutas are currently masked.
  function haystack(p) {
    return esc((p.d + ' ' + p.i).toLowerCase());
  }
  function offerLi(it) {
    return h('li', { class: 'offer', 'data-s': (it.d + ' ' + it.i).toLowerCase() }, [
      h('span', { class: 'offer-n', text: String(it.n) }),
      h('span', { class: 'offer-text', html: pair({ d: it.d, i: it.i }) })
    ]);
  }
  function pairLines(lines, cls) {
    return lines.map(function (l) {
      if (!l.d.trim()) return '<div class="line-gap"></div>';
      return '<div class="ln" data-s="' + haystack(l) + '">' + pair(l, cls) + '</div>';
    }).join('');
  }

  /* ------------------------------------------------------------ theme */

  var themeMode = load(KEY.theme, 'system');
  function applyTheme() {
    var root = document.documentElement;
    if (themeMode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', themeMode);
    $('#theme-toggle').textContent =
      themeMode === 'system' ? 'System' : themeMode === 'dark' ? 'Dark' : 'Light';
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', themeMode === 'light' ? '#f5f2ed' : '#0f0f0f');
  }

  var fontStep = load(KEY.font, 0);
  function applyFont() {
    document.documentElement.style.setProperty('--font-scale', (1 + fontStep * 0.12).toFixed(2));
  }

  /* ------------------------------------------------------------- home */

  function renderHome() {
    var vg = $('#vow-grid');
    vg.innerHTML = '';
    D.routine.counts.forEach(function (c) {
      vg.appendChild(h('div', { class: 'vow-card' }, [
        h('span', { class: 'vow-name', html: pair(c.name) }),
        h('span', { class: 'vow-value', text: c.num >= 1000 ? fmt(c.num) : String(c.num) }),
        h('span', { class: 'vow-en', text: c.en })
      ]));
    });
    $('#vow-foot').innerHTML =
      'Over ' + pair(D.routine.days) + ' — one hundred and fifty days. Signed ' +
      pair(D.routine.signed) + '.';

    var sl = $('#shape-list');
    sl.innerHTML = '';
    D.routine.sections.forEach(function (s) {
      sl.appendChild(h('li', { class: 'shape-item' }, [
        h('span', { class: 'shape-name', html: pair(s.name) }),
        h('span', { class: 'shape-pages', text: s.pages })
      ]));
    });

    $('#ack').textContent = D.acknowledgement;
    $('#reveal-all').textContent = kutasShown ? 'Hide kūṭas again' : 'Reveal kūṭas';

    var holder = $('#hero-yantra');
    if (!holder.firstChild) {
      holder.appendChild(SriChakra.draw(Y, { interactive: false }).svg);
    }
  }

  /* ----------------------------------------------------------- chakra */

  // Groups keyed by the enclosure they sit on.
  var byChakra = {};
  D.avarana.groups.forEach(function (g) {
    (byChakra[g.chakra] = byChakra[g.chakra] || []).push(g);
  });

  var chakraApi = null;
  var chakraSel = null;

  function renderChakra() {
    var holder = $('#yantra-holder');
    if (!holder.firstChild) {
      chakraApi = SriChakra.draw(Y, { onSelect: selectChakra });
      holder.appendChild(chakraApi.svg);

      var legend = $('#chakra-legend');
      SriChakra.REGIONS.forEach(function (r, i) {
        var n = (byChakra[r.key] || []).reduce(function (s, g) { return s + g.items.length; }, 0);
        legend.appendChild(h('button', {
          class: 'legend-row', 'data-region': r.key,
          onclick: function () { selectChakra(r.key); chakraApi.select(r.key); }
        }, [
          h('span', { class: 'legend-idx', text: String(i + 1) }),
          h('span', { class: 'legend-name' }, [
            h('strong', { text: r.label }),
            h('em', { text: r.sub })
          ]),
          h('span', { class: 'legend-n', text: n ? n + ' offering' + (n === 1 ? '' : 's') : '—' })
        ]));
      });
    }
    if (!chakraSel) selectChakra('trailokyamohana');
    if (chakraApi) chakraApi.select(chakraSel);
  }

  function selectChakra(key) {
    chakraSel = key;
    $$('#chakra-legend .legend-row').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-region') === key);
    });

    var region = SriChakra.REGIONS.filter(function (r) { return r.key === key; })[0];
    var groups = byChakra[key] || [];
    var panel = $('#chakra-panel');
    panel.innerHTML = '';

    panel.appendChild(h('div', { class: 'panel-head' }, [
      h('h2', { class: 'panel-title', text: region.label }),
      h('p', { class: 'panel-sub', text: region.sub })
    ]));

    if (!groups.length) {
      panel.appendChild(h('p', { class: 'panel-empty' },
        ['The bindu. The notes carry no separate offering here — it is where the ' +
         'preceding worship comes to rest.']));
      return;
    }

    groups.forEach(function (g) {
      var box = h('div', { class: 'panel-group' });
      box.appendChild(h('h3', { class: 'panel-group-title', html: pair(g.heading) }));
      box.appendChild(h('p', { class: 'panel-range',
        text: 'Offerings ' + g.items[0].n + '–' + g.items[g.items.length - 1].n }));

      var img = h('img', {
        class: 'panel-diagram', loading: 'lazy',
        src: 'diagrams/' + g.id + '.png',
        alt: 'Om Swami’s diagram for ' + g.heading.i
      });
      // av2 was drawn across three sheets; show all three
      if (g.id === 'av2') {
        var strip = h('div', { class: 'diagram-strip' });
        ['av2a', 'av2b', 'av2c'].forEach(function (n) {
          strip.appendChild(h('img', {
            class: 'panel-diagram', loading: 'lazy', src: 'diagrams/' + n + '.png',
            alt: 'Om Swami’s diagram, part of the second āvaraṇa'
          }));
        });
        box.appendChild(strip);
      } else {
        box.appendChild(img);
      }

      var ol = h('ol', { class: 'offer-list' });
      g.items.forEach(function (it) {
        ol.appendChild(offerLi(it));
      });
      box.appendChild(ol);

      if (g.closing && g.closing.length) {
        box.appendChild(h('div', { class: 'closing', html: pairLines(g.closing) }));
      }
      panel.appendChild(box);
    });
  }

  /* ------------------------------------------------------------ krama */

  var KRAMA_TARGET = {  // step number -> anchor in the Text view
    8: 'viniyoga', 9: 'ny-rishyadi', 10: 'ny-karashuddhi', 11: 'ny-asana',
    12: 'ny-hridayadi', 13: 'ny-varna', 14: 'ny-vagdevata', 15: 'ny-srishti',
    16: 'ny-sthiti', 17: 'ny-panchavritti', 18: 'ny-vyapaka', 19: 'ny-kulluka',
    20: 'ny-rahasya', 21: 'ny-kama', 22: 'ny-kara', 23: 'ny-svatantra',
    24: 'pre-mudra', 25: 'pre-peethadevata', 26: 'pre-peethashakti',
    27: 'pre-yantrasana', 29: 'puja', 30: 'pre-ajna', 31: 'avarana',
    32: 'shodashopachara'
  };

  function kramaState() {
    var s = load(KEY.krama, null);
    if (!s || s.date !== today()) s = { date: today(), done: [] };
    return s;
  }

  function renderKrama() {
    var list = $('#krama-list');
    var st = kramaState();
    list.innerHTML = '';

    D.steps.groups.forEach(function (g) {
      if (g.heading) {
        list.appendChild(h('h3', { class: 'krama-head', html: pair(g.heading) }));
      }
      g.items.forEach(function (it) {
        var done = st.done.indexOf(it.n) >= 0;
        var anchor = KRAMA_TARGET[it.n];
        var row = h('label', { class: 'krama-row' + (done ? ' done' : '') }, [
          h('input', {
            type: 'checkbox', class: 'krama-box', checked: done ? 'checked' : null,
            onchange: function (e) { toggleStep(it.n, e.target.checked); }
          }),
          h('span', { class: 'krama-n', text: String(it.n) }),
          h('span', { class: 'krama-text', html: pair(it) })
        ]);
        if (anchor) {
          row.appendChild(h('a', {
            class: 'krama-jump', href: '#text', title: 'Go to the text',
            onclick: function (e) { e.preventDefault(); e.stopPropagation(); goText(anchor); }
          }, ['text →']));
        }
        list.appendChild(row);
      });
    });
    updateKramaBar();
  }

  function toggleStep(n, on) {
    var st = kramaState();
    var i = st.done.indexOf(n);
    if (on && i < 0) st.done.push(n);
    if (!on && i >= 0) st.done.splice(i, 1);
    save(KEY.krama, st);
    $$('.krama-row').forEach(function (r) {
      var box = $('.krama-box', r);
      r.classList.toggle('done', box.checked);
    });
    updateKramaBar();
  }

  function updateKramaBar() {
    var st = kramaState();
    var pct = Math.round(st.done.length / 41 * 100);
    $('#krama-fill').style.width = pct + '%';
    $('#krama-count').textContent = st.done.length + ' / 41';
  }

  /* ------------------------------------------------------------- text */

  function sections() {
    var out = [];
    out.push({ id: 'viniyoga', title: D.viniyoga.heading, kind: 'lines',
               lines: D.viniyoga.lines });
    D.nyasas.forEach(function (n) {
      out.push({ id: 'ny-' + n.id, title: n.heading, kind: 'nyasa', node: n, group: 'Nyāsa' });
    });
    D.preliminaries.forEach(function (p) {
      out.push({ id: 'pre-' + p.id, title: p.heading, kind: 'lines',
                 lines: p.lines, group: 'Sthāpana' });
    });
    out.push({ id: 'puja', title: D.pujaVidhi.heading, kind: 'puja', group: 'Pūjā' });
    out.push({ id: 'shodashopachara', title: D.shodashopachara.heading,
               kind: 'upachara', group: 'Pūjā' });
    out.push({ id: 'avarana', title: D.avarana.heading, kind: 'avarana', group: 'Āvaraṇa' });
    return out;
  }

  function renderText() {
    var secs = sections();
    var toc = $('#text-toc');
    toc.innerHTML = '';
    var lastGroup = null;
    secs.forEach(function (s) {
      if (s.group && s.group !== lastGroup) {
        toc.appendChild(h('span', { class: 'toc-group', text: s.group }));
        lastGroup = s.group;
      }
      toc.appendChild(h('a', {
        class: 'toc-link', href: '#' + s.id,
        onclick: function (e) { e.preventDefault(); goText(s.id); }
      }, [s.title.i]));
    });

    var body = $('#text-body');
    body.innerHTML = '';
    secs.forEach(function (s) { body.appendChild(buildSection(s)); });
    applySearch();
  }

  function buildSection(s) {
    var sec = h('section', { class: 'tsec', id: s.id });
    sec.appendChild(h('h2', { class: 'tsec-title', html: pair(s.title) }));

    if (s.kind === 'lines') {
      sec.appendChild(h('div', { class: 'verse-block', html: pairLines(s.lines) }));
    }

    if (s.kind === 'nyasa') {
      var n = s.node;
      sec.appendChild(h('div', { class: 'verse-block', html: pairLines(n.lines) }));
      if (n.table) {
        sec.appendChild(h('p', { class: 'table-note', html: pair(n.table.note) }));
        var tbl = h('table', { class: 'nyasa-table' });
        var tb = h('tbody');
        n.table.rows.forEach(function (r) {
          var tr = h('tr');
          tr.appendChild(h('th', { html: pair(r.key) }));
          r.cells.forEach(function (c) { tr.appendChild(h('td', { html: pair(c) })); });
          tb.appendChild(tr);
        });
        tbl.appendChild(tb);
        sec.appendChild(h('div', { class: 'table-wrap' }, [tbl]));
      }
      if (n.colophon) {
        sec.appendChild(h('p', { class: 'colophon', html: pair(n.colophon) }));
      }
    }

    if (s.kind === 'puja') {
      D.pujaVidhi.steps.forEach(function (st) {
        sec.appendChild(h('article', { class: 'step-card' }, [
          h('h3', { class: 'step-title' }, [
            h('span', { class: 'step-n', text: String(st.n) }),
            h('span', { html: pair(st.name) }),
            h('span', { class: 'step-mudra', html: pair(st.mudra) })
          ]),
          h('div', { class: 'verse-block', html: pairLines(st.verse) }),
          h('div', { class: 'seal', html: pair(st.seal) })
        ]));
      });
      var pr = D.pujaVidhi.prarthana;
      sec.appendChild(h('article', { class: 'step-card' }, [
        h('h3', { class: 'step-title', html: pair(pr.heading) }),
        h('div', { class: 'verse-block', html: pairLines(pr.verse) }),
        h('div', { class: 'seal', html: pair(pr.seal) }),
        h('p', { class: 'mudra-line', html: pair(pr.mudras) })
      ]));
    }

    if (s.kind === 'upachara') {
      D.shodashopachara.items.forEach(function (u) {
        sec.appendChild(h('article', { class: 'step-card' }, [
          h('h3', { class: 'step-title' }, [
            h('span', { class: 'step-n', text: String(u.n) }),
            h('span', { html: pair(u.name) })
          ]),
          h('div', { class: 'verse-block', html: pairLines([u.verse]) }),
          h('div', { class: 'seal', html: pair(u.seal) })
        ]));
      });
    }

    if (s.kind === 'avarana') {
      sec.appendChild(h('div', { class: 'verse-block',
        html: pairLines([D.avarana.opening]) }));
      D.avarana.groups.forEach(function (g) {
        var art = h('article', { class: 'av-card' + (g.sub ? ' av-sub' : ''), id: 'av-' + g.id });
        art.appendChild(h('h3', { class: 'av-title' }, [
          h('span', { html: pair(g.heading) }),
          h('button', {
            class: 'av-chakra-link', title: 'Show on the Śrī Chakra',
            onclick: function () { showOnChakra(g.chakra); }
          }, ['on the chakra →'])
        ]));
        var ol = h('ol', { class: 'offer-list' });
        g.items.forEach(function (it) {
          ol.appendChild(offerLi(it));
        });
        art.appendChild(ol);
        if (g.closing && g.closing.length) {
          art.appendChild(h('div', { class: 'closing', html: pairLines(g.closing) }));
        }
        sec.appendChild(art);
      });
    }
    return sec;
  }

  function goText(anchor) {
    show('text');
    requestAnimationFrame(function () {
      var el = document.getElementById(anchor);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('flash');
        setTimeout(function () { el.classList.remove('flash'); }, 1200);
      }
    });
  }

  function showOnChakra(key) {
    show('chakra');
    selectChakra(key);
    if (chakraApi) chakraApi.select(key);
    requestAnimationFrame(function () {
      $('#view-chakra').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /* ----------------------------------------------------------- search */

  var searchTerm = '';

  function applySearch() {
    var q = searchTerm.trim().toLowerCase();
    var body = $('#text-body');
    var counter = $('#search-count');
    if (!q) {
      $$('.tsec, .step-card, .av-card, .ln, .offer', body).forEach(function (n) {
        n.classList.remove('hidden-by-search');
      });
      counter.textContent = '';
      return;
    }
    var hits = 0;
    $$('.tsec', body).forEach(function (sec) {
      var any = false;
      $$('.ln, .offer', sec).forEach(function (n) {
        var hay = n.getAttribute('data-s') || n.textContent.toLowerCase();
        var match = hay.indexOf(q) >= 0;
        n.classList.toggle('hidden-by-search', !match);
        if (match) { any = true; hits++; }
      });
      $$('.step-card, .av-card', sec).forEach(function (c) {
        var vis = $$('.ln, .offer', c).some(function (n) {
          return !n.classList.contains('hidden-by-search');
        });
        c.classList.toggle('hidden-by-search', !vis);
      });
      var titleMatch = $('.tsec-title', sec).textContent.toLowerCase().indexOf(q) >= 0;
      sec.classList.toggle('hidden-by-search', !any && !titleMatch);
    });
    counter.textContent = hits ? hits + ' line' + (hits === 1 ? '' : 's') : 'no matches';
  }

  /* ----------------------------------------------------------- sheets */

  var lbIndex = 0;
  var sheetList = D.sheets.concat([{ file: 'Sri-Yantra.png',
    title: 'The Śrī Yantra Om Swami drew, and did the sadhana on' }]);

  function renderSheets() {
    var grid = $('#sheet-grid');
    if (grid.firstChild) return;
    sheetList.forEach(function (s, i) {
      grid.appendChild(h('button', {
        class: 'sheet-card', onclick: function () { openLb(i); }
      }, [
        h('img', { class: 'sheet-thumb', loading: 'lazy',
                   src: 'sheets/' + s.file, alt: s.title }),
        h('span', { class: 'sheet-cap' }, [
          h('span', { class: 'sheet-n', text: i === sheetList.length - 1 ? '—' : String(i + 1) }),
          h('span', { text: s.title })
        ])
      ]));
    });
  }

  function openLb(i) {
    lbIndex = (i + sheetList.length) % sheetList.length;
    var s = sheetList[lbIndex];
    $('#lb-img').src = 'sheets/' + s.file;
    $('#lb-img').alt = s.title;
    $('#lb-title').textContent = s.title;
    $('#lightbox').hidden = false;
    document.body.classList.add('lb-open');
  }
  function closeLb() {
    $('#lightbox').hidden = true;
    document.body.classList.remove('lb-open');
  }

  /* --------------------------------------------------------- practice */

  var JAPA_TARGET = 1500000;
  var DAY_TARGET = 150;

  function japaState() {
    var s = load(KEY.japa, null);
    if (!s || typeof s !== 'object') s = { total: 0, log: [] };
    if (!Array.isArray(s.log)) s.log = [];
    if (typeof s.total !== 'number') s.total = 0;
    return s;
  }

  function addJapa(n) {
    if (!n || n < 1) return;
    var s = japaState();
    var d = today();
    var e = s.log.filter(function (x) { return x.date === d; })[0];
    if (e) e.count += n;
    else s.log.push({ date: d, count: n });
    s.total = s.log.reduce(function (a, x) { return a + x.count; }, 0);
    save(KEY.japa, s);
    renderPractice();
  }

  function undoToday() {
    var s = japaState();
    s.log = s.log.filter(function (x) { return x.date !== today(); });
    s.total = s.log.reduce(function (a, x) { return a + x.count; }, 0);
    save(KEY.japa, s);
    renderPractice();
  }

  function ring(canvas, frac, label) {
    var c = canvas.getContext('2d');
    var w = canvas.width, r = w / 2 - 14;
    c.clearRect(0, 0, w, w);
    var cs = getComputedStyle(document.documentElement);
    c.lineWidth = 12;
    c.strokeStyle = cs.getPropertyValue('--border').trim() || '#2a2a2a';
    c.beginPath(); c.arc(w / 2, w / 2, r, 0, Math.PI * 2); c.stroke();
    if (frac > 0) {
      c.strokeStyle = cs.getPropertyValue('--gold').trim() || '#c9a84c';
      c.lineCap = 'round';
      c.beginPath();
      c.arc(w / 2, w / 2, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(frac, 1));
      c.stroke();
    }
    void label;
  }

  function renderPractice() {
    var s = japaState();
    var frac = s.total / JAPA_TARGET;
    ring($('#japa-ring'), frac);
    $('#japa-pct').textContent = (frac * 100).toFixed(frac < 0.01 ? 2 : 1) + '%';
    $('#japa-total').textContent = fmt(s.total);
    var t = s.log.filter(function (x) { return x.date === today(); })[0];
    $('#japa-today').textContent = t ? 'Today: ' + fmt(t.count) : 'Nothing logged today.';

    var days = load(KEY.days, []);
    if (!Array.isArray(days)) days = [];
    ring($('#day-ring'), days.length / DAY_TARGET);
    $('#day-pct').textContent = String(days.length);
    var doneToday = days.indexOf(today()) >= 0;
    $('#day-mark').textContent = doneToday ? 'Today is marked ✓' : 'Mark today complete';
    $('#day-mark').classList.toggle('is-done', doneToday);
    $('#day-today').textContent = days.length
      ? 'Last: ' + days.slice().sort().pop() : 'No days marked yet.';

    var dots = $('#day-dots');
    dots.innerHTML = '';
    for (var i = 0; i < DAY_TARGET; i++) {
      dots.appendChild(h('span', { class: 'dot' + (i < days.length ? ' on' : '') }));
    }

    var log = $('#japa-log');
    log.innerHTML = '';
    var rows = s.log.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (!rows.length) {
      log.appendChild(h('p', { class: 'log-empty', text: 'No japa logged yet.' }));
    }
    rows.slice(0, 60).forEach(function (r) {
      log.appendChild(h('div', { class: 'log-row' }, [
        h('span', { class: 'log-date', text: r.date }),
        h('span', { class: 'log-bar-wrap' }, [
          h('span', { class: 'log-bar', style: 'width:' +
            Math.max(2, Math.min(100, r.count / 10800 * 100)) + '%' })
        ]),
        h('span', { class: 'log-count', text: fmt(r.count) })
      ]));
    });
  }

  /* ------------------------------------------------------------ views */

  var VIEWS = ['home', 'chakra', 'krama', 'text', 'sheets', 'practice'];
  var currentView = 'home';

  function show(name) {
    if (VIEWS.indexOf(name) < 0) name = 'home';
    currentView = name;
    VIEWS.forEach(function (v) { $('#view-' + v).hidden = v !== name; });
    $$('.nav-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.view === name);
    });
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (name === 'chakra') renderChakra();
    if (name === 'sheets') renderSheets();
    if (name === 'practice') renderPractice();
  }

  function render() {
    renderHome();
    renderKrama();
    renderText();
    if (currentView === 'chakra' && chakraSel) selectChakra(chakraSel);
  }

  /* -------------------------------------------------------------- go */

  var started = false;
  function init() {
    // Every listener below is attached once to a node the renderers reuse, so
    // a second init would double every click. Cheap to make that impossible.
    if (started) return;
    started = true;

    applyTheme();
    applyFont();
    document.body.classList.toggle('kutas-shown', kutasShown);
    $('#script-toggle').textContent = MODE_LABEL[scriptMode];

    render();
    show((location.hash || '#home').slice(1));

    $$('.nav-tab').forEach(function (t) {
      t.addEventListener('click', function (e) { e.preventDefault(); show(t.dataset.view); });
    });
    window.addEventListener('hashchange', function () {
      show((location.hash || '#home').slice(1));
    });

    $('#theme-toggle').addEventListener('click', function () {
      themeMode = themeMode === 'system' ? 'dark' : themeMode === 'dark' ? 'light' : 'system';
      save(KEY.theme, themeMode);
      applyTheme();
      if (currentView === 'practice') renderPractice();
    });

    $('#script-toggle').addEventListener('click', function () {
      scriptMode = MODES[(MODES.indexOf(scriptMode) + 1) % MODES.length];
      save(KEY.script, scriptMode);
      $('#script-toggle').textContent = MODE_LABEL[scriptMode];
      render();
    });

    var fc = $('#font-controls');
    [['A−', -1], ['A+', 1]].forEach(function (p) {
      fc.appendChild(h('button', {
        class: 'ctl-btn font-btn', 'aria-label': p[1] > 0 ? 'Larger text' : 'Smaller text',
        onclick: function () {
          fontStep = Math.max(-1, Math.min(3, fontStep + p[1]));
          save(KEY.font, fontStep);
          applyFont();
        }
      }, [p[0]]));
    });

    $('#reveal-all').addEventListener('click', function () { setKutas(!kutasShown); });

    // tapping a masked kuta reveals everything, with the same warning already
    // stated on the home page
    document.addEventListener('click', function (e) {
      var k = e.target.closest('.kuta');
      if (k && !kutasShown) setKutas(true);
    });

    $('#krama-reset').addEventListener('click', function () {
      save(KEY.krama, { date: today(), done: [] });
      renderKrama();
    });

    var si = $('#text-search');
    var t = null;
    si.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { searchTerm = si.value; applySearch(); }, 140);
    });

    $$('.count-btn[data-add]').forEach(function (b) {
      b.addEventListener('click', function () { addJapa(parseInt(b.dataset.add, 10)); });
    });
    $('#japa-add').addEventListener('click', function () {
      var v = parseInt($('#japa-custom').value, 10);
      if (v > 0) { addJapa(v); $('#japa-custom').value = ''; }
    });
    $('#japa-custom').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('#japa-add').click();
    });
    $('#japa-undo').addEventListener('click', undoToday);
    $('#day-mark').addEventListener('click', function () {
      var days = load(KEY.days, []);
      if (!Array.isArray(days)) days = [];
      var d = today();
      var i = days.indexOf(d);
      if (i >= 0) days.splice(i, 1); else days.push(d);
      save(KEY.days, days);
      renderPractice();
    });

    $('#lb-close').addEventListener('click', closeLb);
    $('#lb-prev').addEventListener('click', function () { openLb(lbIndex - 1); });
    $('#lb-next').addEventListener('click', function () { openLb(lbIndex + 1); });
    $('#lightbox').addEventListener('click', function (e) {
      if (e.target.id === 'lightbox' || e.target.id === 'lb-stage') closeLb();
    });
    document.addEventListener('keydown', function (e) {
      if ($('#lightbox').hidden) return;
      if (e.key === 'Escape') closeLb();
      if (e.key === 'ArrowLeft') openLb(lbIndex - 1);
      if (e.key === 'ArrowRight') openLb(lbIndex + 1);
    });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  // sync.js calls this after it merges a remote change in
  window.SADHANA_ON_SYNC = function () {
    renderKrama();
    if (currentView === 'practice') renderPractice();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
