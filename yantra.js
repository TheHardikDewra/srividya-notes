/* ========================================
   Sri Chakra, drawn from solved coordinates.

   The nine triangles and the 43 cells they cut come from the exact solution
   in yantra-data.js (Chiodo/Huet concurrency conditions, residual ~1e-61,
   carried over from the sri-yantra project). The lotuses, the three circles
   and the bhupura are drawing convention, laid out from `layout`.

   What this file adds over a plain drawing: every enclosure is a addressable
   region with its own hit area, so the figure can be used as the index to the
   avarana puja rather than as decoration.
   ======================================== */

(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var f = function (n) { return n.toFixed(6); };
  var polar = function (r, a) { return [r * Math.cos(a), r * Math.sin(a)]; };

  // Which drawn ring each avarana lives on. Keys match the `chakra` field
  // in data.js, which in turn comes from the Sanskrit closing line of each
  // avarana in the notes ("अत्र सर्वाशापरिपूरके षोडशदलचक्रे …").
  var REGIONS = [
    { key: 'trailokyamohana',     kind: 'bhupura',       label: 'Trailokyamohana', sub: 'bhūpura — three lines, four gates' },
    { key: 'sarvashaparipuraka',  kind: 'lotus16',       label: 'Sarvāśāparipūraka', sub: 'sixteen-petalled lotus' },
    { key: 'sarvasamkshobhana',   kind: 'lotus8',        label: 'Sarvasaṃkṣobhaṇa', sub: 'eight-petalled lotus' },
    { key: 'sarvasaubhagyadayaka', kind: 'chaturdasara', label: 'Sarvasaubhāgyadāyaka', sub: 'fourteen triangles' },
    { key: 'sarvarthasadhaka',    kind: 'bahirdasara',   label: 'Sarvārthasādhaka', sub: 'outer ten triangles' },
    { key: 'sarvarakshakara',     kind: 'antardasara',   label: 'Sarvarakṣākara', sub: 'inner ten triangles' },
    { key: 'sarvarogahara',       kind: 'ashtakona',     label: 'Sarvarogahara', sub: 'eight triangles' },
    { key: 'sarvasiddhiprada',    kind: 'trikona',       label: 'Sarvasiddhiprada', sub: 'the central triangle' },
    { key: 'sarvanandamaya',      kind: 'bindu',         label: 'Sarvānandamaya', sub: 'the bindu' }
  ];

  // Petal outline: two cubics from base corner to tip and back. Neighbours
  // share their base point so there is no gap between petals.
  var LOW_R = 0.30, LOW_A = 1.02, HIGH_R = 0.74, HIGH_A = 0.40;

  function petalRing(n, r0, r1) {
    var half = Math.PI / n, span = r1 - r0, out = [];
    for (var k = 0; k < n; k++) {
      var am = 2 * Math.PI * k / n;
      var p0 = polar(r0, am - half), p1 = polar(r0, am + half), t = polar(r1, am);
      var a = polar(r0 + LOW_R * span, am - half * LOW_A);
      var b = polar(r0 + HIGH_R * span, am - half * HIGH_A);
      var c = polar(r0 + HIGH_R * span, am + half * HIGH_A);
      var d = polar(r0 + LOW_R * span, am + half * LOW_A);
      out.push('M' + f(p0[0]) + ',' + f(-p0[1]) +
        'C' + f(a[0]) + ',' + f(-a[1]) + ' ' + f(b[0]) + ',' + f(-b[1]) + ' ' + f(t[0]) + ',' + f(-t[1]) +
        'C' + f(c[0]) + ',' + f(-c[1]) + ' ' + f(d[0]) + ',' + f(-d[1]) + ' ' + f(p1[0]) + ',' + f(-p1[1]) + 'Z');
    }
    return out.join(' ');
  }

  // The k-th of the three parallel bhupura lines. One side is laid out then
  // rotated a quarter turn three times; k counts inwards.
  function bhupura(L, k) {
    var g = L.gate, d = (k || 0) * g.inset;
    var s = L.bhupura[0] - d, reach = g.reach - d, step = g.step + d;
    var cap = g.cap - d, neck = g.neck - d;
    var side = [[-s, s], [-neck, s], [-neck, step], [-cap, step], [-cap, reach],
                [cap, reach], [cap, step], [neck, step], [neck, s], [s, s]];
    var pts = [];
    for (var q = 0; q < 4; q++) {
      for (var i = 0; i < side.length; i++) {
        var x = side[i][0], y = side[i][1];
        for (var r = 0; r < q; r++) { var t = x; x = y; y = -t; }
        var last = pts[pts.length - 1];
        if (!last || Math.hypot(x - last[0], y - last[1]) > 1e-9) pts.push([x, y]);
      }
    }
    return 'M' + pts.map(function (p) { return f(p[0]) + ',' + f(-p[1]); }).join(' L') + ' Z';
  }

  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    return n;
  }

  function circlePath(r) {
    // a circle as a path, so it can share a fill-rule with another subpath
    return 'M' + f(-r) + ',0 A' + f(r) + ',' + f(r) + ' 0 1 0 ' + f(r) +
           ',0 A' + f(r) + ',' + f(r) + ' 0 1 0 ' + f(-r) + ',0 Z';
  }

  function trianglesOf(data, ring) {
    return data.yantra_triangles.filter(function (t) { return t.avarana === ring; });
  }

  function polyPoints(t) {
    return t.points.map(function (p) { return f(p[0]) + ',' + f(-p[1]); }).join(' ');
  }

  /* ----------------------------------------------------------------
     draw(data, opts) -> { svg, select(key), regions }
     ---------------------------------------------------------------- */
  function draw(data, opts) {
    opts = opts || {};
    var L = data.layout;
    var interactive = opts.interactive !== false;
    var span = L.gate.reach + 0.05;
    var size = 1000;
    var k = size / (2 * span);

    var svg = el('svg', {
      xmlns: NS, viewBox: '0 0 ' + size + ' ' + size,
      class: 'yantra' + (interactive ? ' yantra-interactive' : ''),
      role: interactive ? 'group' : 'img',
      'aria-label': 'Sri Chakra, nine enclosures'
    });

    var root = el('g', {
      transform: 'translate(' + size / 2 + ',' + size / 2 + ') scale(' + k + ')',
      fill: 'none', stroke: 'currentColor',
      'stroke-width': (1.7 / k).toFixed(6), 'stroke-linejoin': 'round'
    });
    svg.appendChild(root);

    // --- fills, behind the lines -----------------------------------
    var fills = el('g', { class: 'y-fills', stroke: 'none' });
    root.appendChild(fills);

    function regionFill(key, d, isPoly) {
      var node = isPoly
        ? el('g', { class: 'y-region', 'data-region': key })
        : el('path', { class: 'y-region', 'data-region': key, d: d, 'fill-rule': 'evenodd' });
      fills.appendChild(node);
      return node;
    }

    // bhupura field: outer square minus the outermost circle
    regionFill('trailokyamohana', bhupura(L, 0) + ' ' + circlePath(L.trivritta[L.trivritta.length - 1]));
    regionFill('sarvashaparipuraka', petalRing(16, L.lotus16[0], L.lotus16[1]));
    regionFill('sarvasamkshobhana', petalRing(8, L.lotus8[0], L.lotus8[1]));

    ['chaturdasara', 'bahirdasara', 'antardasara', 'ashtakona', 'trikona'].forEach(function (ring) {
      var region = REGIONS.filter(function (r) { return r.kind === ring; })[0];
      var g = regionFill(region.key, null, true);
      trianglesOf(data, ring).forEach(function (t) {
        g.appendChild(el('polygon', { points: polyPoints(t) }));
      });
    });

    var binduG = regionFill('sarvanandamaya', null, true);
    binduG.appendChild(el('circle', { cx: f(data.bindu[0]), cy: f(-data.bindu[1]), r: L.bindu * 2.6 }));

    // --- the drawn figure ------------------------------------------
    var lines = el('g', { class: 'y-lines' });
    root.appendChild(lines);

    for (var i = 0; i < L.bhupura.length; i++) lines.appendChild(el('path', { d: bhupura(L, i) }));
    L.trivritta.forEach(function (r) { lines.appendChild(el('circle', { cx: 0, cy: 0, r: r })); });
    lines.appendChild(el('path', { d: petalRing(16, L.lotus16[0], L.lotus16[1]) }));
    lines.appendChild(el('path', { d: petalRing(8, L.lotus8[0], L.lotus8[1]) }));
    lines.appendChild(el('circle', { cx: 0, cy: 0, r: L.circle }));

    // the nine generating triangles, which is what actually makes the figure
    data.triangles.forEach(function (t) {
      lines.appendChild(el('polygon', { points: polyPoints(t) }));
    });

    lines.appendChild(el('circle', {
      cx: f(data.bindu[0]), cy: f(-data.bindu[1]), r: L.bindu,
      fill: 'currentColor', stroke: 'none'
    }));

    if (!interactive) return { svg: svg, select: function () {}, regions: REGIONS };

    // --- hit areas, on top and invisible ---------------------------
    var hits = el('g', { class: 'y-hits', fill: 'transparent', stroke: 'none' });
    root.appendChild(hits);

    function hit(key, d, polys) {
      var node;
      if (polys) {
        node = el('g', { class: 'y-hit', 'data-region': key });
        polys.forEach(function (p) { node.appendChild(el('polygon', { points: p })); });
      } else {
        node = el('path', { class: 'y-hit', 'data-region': key, d: d, 'fill-rule': 'evenodd' });
      }
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      hits.appendChild(node);
      return node;
    }

    hit('trailokyamohana', bhupura(L, 0) + ' ' + circlePath(L.trivritta[L.trivritta.length - 1]));
    hit('sarvashaparipuraka', petalRing(16, L.lotus16[0], L.lotus16[1]));
    hit('sarvasamkshobhana', petalRing(8, L.lotus8[0], L.lotus8[1]));
    ['chaturdasara', 'bahirdasara', 'antardasara', 'ashtakona', 'trikona'].forEach(function (ring) {
      var region = REGIONS.filter(function (r) { return r.kind === ring; })[0];
      hit(region.key, null, trianglesOf(data, ring).map(polyPoints));
    });
    hit('sarvanandamaya', circlePath(L.bindu * 3.2));

    var current = null;
    function select(key) {
      current = key;
      svg.classList.toggle('has-selection', !!key);
      Array.prototype.forEach.call(svg.querySelectorAll('[data-region]'), function (n) {
        n.classList.toggle('is-active', n.getAttribute('data-region') === key);
      });
    }

    function fire(key) {
      select(key);
      if (opts.onSelect) opts.onSelect(key);
    }

    hits.addEventListener('click', function (e) {
      var n = e.target.closest('[data-region]');
      if (n) fire(n.getAttribute('data-region'));
    });
    hits.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var n = e.target.closest('[data-region]');
      if (n) { e.preventDefault(); fire(n.getAttribute('data-region')); }
    });
    hits.addEventListener('mouseover', function (e) {
      var n = e.target.closest('[data-region]');
      if (!n) return;
      var key = n.getAttribute('data-region');
      Array.prototype.forEach.call(svg.querySelectorAll('.y-region'), function (r) {
        r.classList.toggle('is-hover', r.getAttribute('data-region') === key && key !== current);
      });
    });
    hits.addEventListener('mouseleave', function () {
      Array.prototype.forEach.call(svg.querySelectorAll('.is-hover'), function (r) {
        r.classList.remove('is-hover');
      });
    });

    return { svg: svg, select: select, regions: REGIONS };
  }

  global.SriChakra = { draw: draw, REGIONS: REGIONS, petalRing: petalRing, bhupura: bhupura };
})(window);
