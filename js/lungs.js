/* ============================================================
   LungViz — a living, breathing SVG lung visualization.
   Aesthetic build: glassy translucent tissue + a procedurally
   grown bronchial tree (airways), soft mottling instead of dots,
   and a luminous rim light. As damage rises the fine airways
   wither, the tissue desaturates, and the breathing turns
   shallow and labored.

   Exposes window.LungViz:
     mount(hostEl)     -> inject the SVG
     setDamage(0..100) -> morph toward a damage level
     getDamage()       -> current rendered damage
   ============================================================ */
(function () {
  "use strict";

  var svgNS = "http://www.w3.org/2000/svg";

  // Screen-left lung silhouette (viewBox center x = 200).
  // The right lung is a mirror of this path.
  var LUNG_PATH =
    "M190 118 C176 112 154 118 138 138 C116 164 98 200 90 244 " +
    "C84 282 86 322 104 352 C120 378 150 388 172 380 " +
    "C188 374 196 356 197 330 C199 286 198 232 199 176 " +
    "C199 152 198 130 190 118 Z";

  var state = {
    host: null,
    el: {},
    segs: [],         // bronchial tree segment elements + metadata
    tar: [],
    damage: 0,
    rendered: 0,
    lastApplied: -1,
    phase: 0,
    last: 0,
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

  // Grow a recursive bronchial tree of line segments.
  function growTree(segs, leaves, rng, x, y, angle, len, w, depth) {
    if (depth <= 0 || len < 4 || w < 0.45) {
      leaves.push({ x: x, y: y });
      return;
    }
    var x2 = x + Math.cos(angle) * len;
    var y2 = y + Math.sin(angle) * len;
    segs.push({ x1: x, y1: y, x2: x2, y2: y2, w: w, depth: depth });

    var spread = 0.32 + rng() * 0.42;
    var lenF = 0.70 + rng() * 0.08;
    var wF = 0.70;

    growTree(segs, leaves, rng, x2, y2, angle - spread * (0.6 + rng() * 0.7), len * lenF, w * wF, depth - 1);
    growTree(segs, leaves, rng, x2, y2, angle + spread * (0.6 + rng() * 0.7), len * lenF, w * wF, depth - 1);
    if (rng() > 0.66) {
      growTree(segs, leaves, rng, x2, y2, angle + (rng() - 0.5) * 0.4, len * lenF * 0.9, w * wF * 0.85, depth - 1);
    }
  }

  function buildTree() {
    var segs = [], leaves = [];
    var rng = makeRNG(20240607);
    var ex = 186, ey = 150;           // bronchus entry into the lung
    state.rootW = 9;
    // main bronchus stub
    segs.push({ x1: 200, y1: 132, x2: ex, y2: ey, w: 10, depth: 8 });
    // lower / lateral fan
    growTree(segs, leaves, rng, ex, ey, (118 * Math.PI) / 180, 60, 8.5, 7);
    // upper lobe toward the apex
    growTree(segs, leaves, rng, ex, ey, (242 * Math.PI) / 180, 42, 6.5, 6);
    return { segs: segs, leaves: leaves };
  }

  function mount(host) {
    state.host = host;
    var tree = buildTree();

    var svg = create("svg", {
      viewBox: "0 0 400 440",
      width: "100%",
      preserveAspectRatio: "xMidYMid meet",
    });

    // ---------- defs ----------
    var defs = create("defs");

    // Tissue gradient (updated by damage).
    var fill = create("linearGradient", { id: "lvFill", x1: "0.15", y1: "0", x2: "0.7", y2: "1" });
    var fs = [
      create("stop", { offset: "0%", "stop-color": "rgba(255,182,196,0.92)" }),
      create("stop", { offset: "52%", "stop-color": "rgba(238,120,142,0.90)" }),
      create("stop", { offset: "100%", "stop-color": "rgba(196,72,98,0.92)" }),
    ];
    fs.forEach(function (s) { fill.append(s); });
    state.el.fillStops = fs;
    defs.append(fill);

    // Edge-darkening for depth.
    var shade = create("radialGradient", { id: "lvShade", cx: "0.42", cy: "0.38", r: "0.75" });
    shade.append(
      create("stop", { offset: "55%", "stop-color": "rgba(0,0,0,0)" }),
      create("stop", { offset: "100%", "stop-color": "rgba(20,8,14,0.45)" })
    );
    defs.append(shade);

    // Specular sheen for a glassy look.
    var sheen = create("radialGradient", { id: "lvSheen", cx: "0.34", cy: "0.26", r: "0.5" });
    sheen.append(
      create("stop", { offset: "0%", "stop-color": "rgba(255,255,255,0.55)" }),
      create("stop", { offset: "100%", "stop-color": "rgba(255,255,255,0)" })
    );
    defs.append(sheen);

    // Soft glow for the airways.
    var glow = create("filter", { id: "lvTreeGlow", x: "-40%", y: "-40%", width: "180%", height: "180%" });
    glow.append(create("feGaussianBlur", { stdDeviation: "1.6" }));
    defs.append(glow);

    // Blur for soft tar mottling.
    var soft = create("filter", { id: "lvSoft", x: "-60%", y: "-60%", width: "220%", height: "220%" });
    soft.append(create("feGaussianBlur", { stdDeviation: "9" }));
    defs.append(soft);

    // Clip = both lungs.
    var clip = create("clipPath", { id: "lvClip" });
    clip.append(create("path", { d: LUNG_PATH }));
    clip.append(create("path", { d: LUNG_PATH, transform: "translate(400,0) scale(-1,1)" }));
    defs.append(clip);

    svg.append(defs);

    // ---------- breathing group ----------
    var breath = create("g", { id: "lvBreath" });
    state.el.breath = breath;

    // Trachea (sits above and between the lungs).
    var trachea = create("path", {
      d: "M200 34 L200 132",
      fill: "none", stroke: "rgba(206,214,240,0.85)", "stroke-width": "11", "stroke-linecap": "round",
    });
    state.el.trachea = trachea;

    // Tissue bodies.
    var leftBody = create("path", { d: LUNG_PATH, fill: "url(#lvFill)" });
    var rightBody = create("path", { d: LUNG_PATH, fill: "url(#lvFill)", transform: "translate(400,0) scale(-1,1)" });

    // Luminous rim.
    var leftRim = create("path", { d: LUNG_PATH, fill: "none", stroke: "rgba(255,210,220,0.5)", "stroke-width": "1.4" });
    var rightRim = create("path", { d: LUNG_PATH, fill: "none", stroke: "rgba(255,210,220,0.5)", "stroke-width": "1.4", transform: "translate(400,0) scale(-1,1)" });
    state.el.rims = [leftRim, rightRim];

    breath.append(leftBody, rightBody);

    // ---------- clipped interior ----------
    var inner = create("g", { "clip-path": "url(#lvClip)" });

    // Soft tar mottling (revealed with damage).
    var tarGroup = create("g", { filter: "url(#lvSoft)" });
    var trng = makeRNG(7777);
    for (var i = 0; i < 9; i++) {
      var tx = 96 + trng() * 96;
      var ty = 170 + trng() * 196;
      var tr = 16 + trng() * 26;
      var th = trng() * 0.65;
      var a = create("circle", { cx: tx, cy: ty, r: tr, fill: "#1c130c", opacity: "0" });
      var b = create("circle", { cx: 400 - tx, cy: ty, r: tr * 0.92, fill: "#221710", opacity: "0" });
      tarGroup.append(a, b);
      state.tar.push({ nodes: [a, b], threshold: th });
    }

    // Edge shade + glassy sheen.
    var shadeRect = create("rect", { x: "0", y: "0", width: "400", height: "440", fill: "url(#lvShade)" });
    var sheenL = create("ellipse", { cx: "150", cy: "190", rx: "60", ry: "90", fill: "url(#lvSheen)", opacity: "0.7" });
    var sheenR = create("ellipse", { cx: "250", cy: "190", rx: "60", ry: "90", fill: "url(#lvSheen)", opacity: "0.7" });
    state.el.sheen = [sheenL, sheenR];

    // Bronchial tree (left built, right mirrored).
    function renderTree(mirror) {
      var g = create("g", {
        fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round",
        filter: "url(#lvTreeGlow)",
      });
      if (mirror) g.setAttribute("transform", "translate(400,0) scale(-1,1)");
      tree.segs.forEach(function (s) {
        var ln = create("line", {
          x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
          "stroke-width": s.w.toFixed(2),
          stroke: "rgba(190,250,238,0.9)",
        });
        g.append(ln);
        state.segs.push({ node: ln, w: s.w, depth: s.depth });
      });
      // terminal alveoli dots
      tree.leaves.forEach(function (lf) {
        var d = create("circle", { cx: lf.x, cy: lf.y, r: 1.7, fill: "rgba(210,255,246,0.8)" });
        g.append(d);
        state.segs.push({ node: d, w: 0.9, depth: 0, leaf: true });
      });
      return g;
    }

    var treeL = renderTree(false);
    var treeR = renderTree(true);

    inner.append(shadeRect, treeL, treeR, tarGroup, sheenL, sheenR);
    breath.append(inner, leftRim, rightRim, trachea);

    svg.append(breath);
    host.innerHTML = "";
    host.append(svg);

    state.last = performance.now();
    loop(state.last);
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) {
    return [
      Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t)),
    ];
  }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  // Tissue colors: healthy rose -> diseased grey.
  var FILL_HEALTHY = [[255, 182, 196], [238, 120, 142], [196, 72, 98]];
  var FILL_SICK = [[150, 140, 130], [110, 100, 92], [74, 66, 58]];

  function applyDamage(d) {
    var t = d / 100;

    // Tissue gradient.
    for (var i = 0; i < 3; i++) {
      state.el.fillStops[i].setAttribute("stop-color", rgba(mix(FILL_HEALTHY[i], FILL_SICK[i], t), 0.92));
    }

    // Rim light: rosy -> dim brown.
    var rimC = mix([255, 210, 220], [120, 96, 80], t);
    state.el.rims.forEach(function (r) { r.setAttribute("stroke", rgba(rimC, lerp(0.5, 0.25, t))); });

    // Sheen fades as the surface dulls.
    state.el.sheen.forEach(function (s) { s.setAttribute("opacity", (0.7 * (1 - t * 0.85)).toFixed(3)); });

    // Trachea discolors slightly.
    var trC = mix([206, 214, 240], [120, 110, 100], t);
    state.el.trachea.setAttribute("stroke", rgba(trC, 0.85));

    // Airways: bright teal -> dull brown, with fine branches withering.
    var treeC = mix([190, 250, 238], [120, 86, 64], t);
    var stroke = rgba(treeC, 0.9);
    var minVisible = t * (state.rootW * 0.62); // thin branches vanish first
    var fadeBand = Math.max(0.7, state.rootW * 0.16);
    state.segs.forEach(function (s) {
      s.node.setAttribute("stroke", stroke);
      if (s.leaf) { s.node.setAttribute("fill", rgba(treeC, 0.8)); }
      var op = (s.w - minVisible) / fadeBand;
      op = Math.max(0, Math.min(1, op));
      // deeper (finer) branches a touch dimmer for depth
      op *= s.leaf ? 0.85 : 1;
      s.node.setAttribute("opacity", op.toFixed(3));
    });

    // Tar mottling.
    state.tar.forEach(function (item) {
      var reveal = (t - item.threshold) / (1 - item.threshold);
      reveal = Math.max(0, Math.min(1, reveal));
      var op = (reveal * 0.85).toFixed(3);
      item.nodes[0].setAttribute("opacity", op);
      item.nodes[1].setAttribute("opacity", op);
    });

    // Drive the global CSS hue (teal -> red).
    document.documentElement.style.setProperty("--health-hue", String(Math.round(lerp(158, 4, t))));
  }

  function loop(now) {
    var dt = Math.min(0.05, (now - state.last) / 1000);
    state.last = now;

    state.rendered += (state.damage - state.rendered) * Math.min(1, dt * 2.2);
    if (Math.abs(state.rendered - state.lastApplied) > 0.08) {
      applyDamage(state.rendered);
      state.lastApplied = state.rendered;
    }

    var t = state.rendered / 100;
    var rate = lerp(0.26, 0.62, t);     // breaths get faster
    var depth = lerp(0.05, 0.016, t);   // and shallower

    state.phase += dt * rate * Math.PI * 2;
    var s = Math.sin(state.phase);
    if (t > 0.6) s += Math.sin(state.phase * 3.1) * 0.18 * (t - 0.6); // labored catch

    var sy = 1 + s * depth;
    var sx = 1 + s * depth * 0.55;
    var cx = 200, cy = 150;
    state.el.breath.setAttribute(
      "transform",
      "translate(" + cx + "," + cy + ") scale(" + sx.toFixed(4) + "," + sy.toFixed(4) + ") translate(" + -cx + "," + -cy + ")"
    );

    state.raf = requestAnimationFrame(loop);
  }

  window.LungViz = {
    mount: mount,
    setDamage: function (d) { state.damage = Math.max(0, Math.min(100, d)); },
    getDamage: function () { return state.rendered; },
  };
})();
