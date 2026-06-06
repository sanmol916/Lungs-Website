/* ============================================================
   LungViz — high-performance breathing lungs.

   Performance model:
   - The SVG is built ONCE. No SVG filters (they are the main
     cause of per-frame re-rasterization lag).
   - Breathing is a GPU-composited CSS transform animation on the
     host element — zero JavaScript per frame.
   - Damage changes run a SHORT, bounded requestAnimationFrame
     tween that stops the instant it settles. There is no
     permanent animation loop in JS.

   API:
     mount(hostEl)
     setDamage(0..100)
     getDamage()
   ============================================================ */
(function () {
  "use strict";

  var svgNS = "http://www.w3.org/2000/svg";

  // Screen-left lung silhouette (viewBox center x = 200).
  var LUNG_PATH =
    "M190 118 C176 112 154 118 138 138 C116 164 98 200 90 244 " +
    "C84 282 86 322 104 352 C120 378 150 388 172 380 " +
    "C188 374 196 356 197 330 C199 286 198 232 199 176 " +
    "C199 152 198 130 190 118 Z";

  var state = {
    host: null,
    el: {},
    segs: [],
    tar: [],
    target: 0,
    rendered: 0,
    raf: null,
    rootW: 9,
  };

  function create(tag, attrs) {
    var node = document.createElementNS(svgNS, tag);
    if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function makeRNG(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }

  function growTree(segs, leaves, rng, x, y, angle, len, w, depth) {
    if (depth <= 0 || len < 5 || w < 0.5) {
      leaves.push({ x: x, y: y });
      return;
    }
    var x2 = x + Math.cos(angle) * len;
    var y2 = y + Math.sin(angle) * len;
    segs.push({ x1: x, y1: y, x2: x2, y2: y2, w: w });

    var spread = 0.32 + rng() * 0.40;
    var lenF = 0.70 + rng() * 0.08;
    growTree(segs, leaves, rng, x2, y2, angle - spread * (0.6 + rng() * 0.7), len * lenF, w * 0.70, depth - 1);
    growTree(segs, leaves, rng, x2, y2, angle + spread * (0.6 + rng() * 0.7), len * lenF, w * 0.70, depth - 1);
    if (rng() > 0.7) {
      growTree(segs, leaves, rng, x2, y2, angle + (rng() - 0.5) * 0.4, len * lenF * 0.9, w * 0.6, depth - 1);
    }
  }

  function buildTree() {
    var segs = [], leaves = [];
    var rng = makeRNG(20240607);
    var ex = 186, ey = 150;
    state.rootW = 9;
    segs.push({ x1: 200, y1: 132, x2: ex, y2: ey, w: 9 });
    growTree(segs, leaves, rng, ex, ey, (118 * Math.PI) / 180, 58, 8, 6);
    growTree(segs, leaves, rng, ex, ey, (242 * Math.PI) / 180, 40, 6, 5);
    return { segs: segs, leaves: leaves };
  }

  function stop(off, color, op) {
    return create("stop", { offset: off, "stop-color": color, "stop-opacity": String(op) });
  }

  function mount(host) {
    state.host = host;
    var tree = buildTree();

    var svg = create("svg", {
      viewBox: "0 0 400 440",
      width: "100%",
      preserveAspectRatio: "xMidYMid meet",
    });

    var defs = create("defs");

    // Tissue gradient.
    var fill = create("linearGradient", { id: "lvFill", x1: "0.15", y1: "0", x2: "0.7", y2: "1" });
    var fs = [stop("0%", "#ffb6c4", 0.95), stop("52%", "#ee788e", 0.92), stop("100%", "#c44862", 0.95)];
    fs.forEach(function (s) { fill.append(s); });
    state.el.fillStops = fs;
    defs.append(fill);

    // Edge shade (depth) — radial gradient, no filter.
    var shade = create("radialGradient", { id: "lvShade", cx: "0.42", cy: "0.36", r: "0.78" });
    shade.append(stop("55%", "#000000", 0), stop("100%", "#140810", 0.5));
    defs.append(shade);

    // Glassy sheen.
    var sheen = create("radialGradient", { id: "lvSheen", cx: "0.34", cy: "0.26", r: "0.55" });
    sheen.append(stop("0%", "#ffffff", 0.5), stop("100%", "#ffffff", 0));
    defs.append(sheen);

    // Soft tar (radial gradient gives soft edges without a blur filter).
    var tar = create("radialGradient", { id: "lvTar", cx: "0.5", cy: "0.5", r: "0.5" });
    tar.append(stop("0%", "#150d07", 0.92), stop("55%", "#1d130b", 0.5), stop("100%", "#1d130b", 0));
    defs.append(tar);

    var clip = create("clipPath", { id: "lvClip" });
    clip.append(create("path", { d: LUNG_PATH }));
    clip.append(create("path", { d: LUNG_PATH, transform: "translate(400,0) scale(-1,1)" }));
    defs.append(clip);

    svg.append(defs);

    // Trachea.
    var trachea = create("path", {
      d: "M200 34 L200 132", fill: "none",
      stroke: "#ced6f0", "stroke-opacity": "0.85", "stroke-width": "11", "stroke-linecap": "round",
    });
    state.el.trachea = trachea;

    var leftBody = create("path", { d: LUNG_PATH, fill: "url(#lvFill)" });
    var rightBody = create("path", { d: LUNG_PATH, fill: "url(#lvFill)", transform: "translate(400,0) scale(-1,1)" });

    var leftRim = create("path", { d: LUNG_PATH, fill: "none", stroke: "#ffd2dc", "stroke-opacity": "0.5", "stroke-width": "1.4" });
    var rightRim = create("path", { d: LUNG_PATH, fill: "none", stroke: "#ffd2dc", "stroke-opacity": "0.5", "stroke-width": "1.4", transform: "translate(400,0) scale(-1,1)" });
    state.el.rims = [leftRim, rightRim];

    var inner = create("g", { "clip-path": "url(#lvClip)" });

    // Tar blobs.
    var tarGroup = create("g");
    var trng = makeRNG(7777);
    for (var i = 0; i < 8; i++) {
      var tx = 98 + trng() * 92;
      var ty = 172 + trng() * 190;
      var tr = 22 + trng() * 26;
      var th = trng() * 0.6;
      var a = create("circle", { cx: tx, cy: ty, r: tr, fill: "url(#lvTar)", opacity: "0" });
      var b = create("circle", { cx: 400 - tx, cy: ty, r: tr * 0.92, fill: "url(#lvTar)", opacity: "0" });
      tarGroup.append(a, b);
      state.tar.push({ nodes: [a, b], threshold: th });
    }

    var shadeRect = create("rect", { x: "0", y: "0", width: "400", height: "440", fill: "url(#lvShade)" });
    var sheenL = create("ellipse", { cx: "150", cy: "188", rx: "58", ry: "88", fill: "url(#lvSheen)", opacity: "0.65" });
    var sheenR = create("ellipse", { cx: "250", cy: "188", rx: "58", ry: "88", fill: "url(#lvSheen)", opacity: "0.65" });
    state.el.sheen = [sheenL, sheenR];

    function renderTree(mirror) {
      var g = create("g", { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" });
      if (mirror) g.setAttribute("transform", "translate(400,0) scale(-1,1)");
      tree.segs.forEach(function (s) {
        // Pre-baked glow: a wide, faint stroke underneath the crisp line.
        // Static (no filter, no per-frame work) — looks glowing, runs fast.
        var halo = create("line", {
          x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
          "stroke-width": (s.w * 3 + 2).toFixed(2), stroke: "#bdf3ea", "stroke-opacity": "0.2",
        });
        var ln = create("line", {
          x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
          "stroke-width": s.w.toFixed(2), stroke: "#bdf3ea", "stroke-opacity": "0.9",
        });
        g.append(halo, ln);
        state.segs.push({ node: halo, w: s.w, leaf: false, glow: true });
        state.segs.push({ node: ln, w: s.w, leaf: false, glow: false });
      });
      tree.leaves.forEach(function (lf) {
        var glowDot = create("circle", { cx: lf.x, cy: lf.y, r: 4.6, fill: "#bdf3ea", "fill-opacity": "0.16" });
        var d = create("circle", { cx: lf.x, cy: lf.y, r: 1.7, fill: "#d2fff6", "fill-opacity": "0.85" });
        g.append(glowDot, d);
        state.segs.push({ node: glowDot, w: 0.95, leaf: true, glow: true });
        state.segs.push({ node: d, w: 0.95, leaf: true, glow: false });
      });
      return g;
    }

    inner.append(shadeRect, renderTree(false), renderTree(true), tarGroup, sheenL, sheenR);

    var group = create("g");
    group.append(leftBody, rightBody, inner, leftRim, rightRim, trachea);
    svg.append(group);

    host.innerHTML = "";
    host.append(svg);

    // Initial paint + start the CSS breathing.
    applyDamage(0);
    applyBreath(0);
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) {
    return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
  }
  function hex(c) {
    return "#" + c.map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("");
  }

  var FILL_HEALTHY = [[255, 182, 196], [238, 120, 142], [196, 72, 98]];
  var FILL_SICK = [[150, 140, 130], [110, 100, 92], [74, 66, 58]];

  function applyBreath(t) {
    if (!state.host) return;
    // Shallower + faster as damage rises.
    var amp = lerp(1.05, 1.018, t);
    var dur = lerp(4.6, 2.3, t);
    state.host.style.setProperty("--breath-amp", amp.toFixed(4));
    state.host.style.setProperty("--breath-dur", dur.toFixed(2) + "s");
  }

  function applyDamage(d) {
    var t = d / 100;

    for (var i = 0; i < 3; i++) {
      state.el.fillStops[i].setAttribute("stop-color", hex(mix(FILL_HEALTHY[i], FILL_SICK[i], t)));
    }

    var rimC = hex(mix([255, 210, 220], [120, 96, 80], t));
    state.el.rims.forEach(function (r) {
      r.setAttribute("stroke", rimC);
      r.setAttribute("stroke-opacity", lerp(0.5, 0.25, t).toFixed(3));
    });

    state.el.sheen.forEach(function (s) { s.setAttribute("opacity", (0.65 * (1 - t * 0.85)).toFixed(3)); });

    state.el.trachea.setAttribute("stroke", hex(mix([206, 214, 240], [120, 110, 100], t)));

    var treeC = hex(mix([189, 243, 234], [120, 86, 64], t));
    var minVisible = t * (state.rootW * 0.62);
    var fadeBand = Math.max(0.7, state.rootW * 0.16);
    state.segs.forEach(function (s) {
      if (s.leaf) s.node.setAttribute("fill", treeC);
      else s.node.setAttribute("stroke", treeC);
      var fade = Math.max(0, Math.min(1, (s.w - minVisible) / fadeBand));
      var base = s.glow ? (s.leaf ? 0.16 : 0.2) : (s.leaf ? 0.85 : 0.9);
      var op = fade * base;
      s.node.setAttribute(s.leaf ? "fill-opacity" : "stroke-opacity", op.toFixed(3));
    });

    state.tar.forEach(function (item) {
      var reveal = Math.max(0, Math.min(1, (t - item.threshold) / (1 - item.threshold)));
      var op = (reveal * 0.9).toFixed(3);
      item.nodes[0].setAttribute("opacity", op);
      item.nodes[1].setAttribute("opacity", op);
    });

    document.documentElement.style.setProperty("--health-hue", String(Math.round(lerp(158, 4, t))));
  }

  // Bounded tween: runs only while settling, then stops.
  function tick() {
    state.rendered += (state.target - state.rendered) * 0.12;
    if (Math.abs(state.target - state.rendered) < 0.15) {
      state.rendered = state.target;
      applyDamage(state.rendered);
      applyBreath(state.rendered / 100);
      state.raf = null;
      return;
    }
    applyDamage(state.rendered);
    applyBreath(state.rendered / 100);
    state.raf = requestAnimationFrame(tick);
  }

  window.LungViz = {
    mount: mount,
    setDamage: function (d) {
      state.target = Math.max(0, Math.min(100, d));
      if (!state.raf) state.raf = requestAnimationFrame(tick);
    },
    getDamage: function () { return state.rendered; },
  };
})();
