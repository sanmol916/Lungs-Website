/* ============================================================
   LungViz — a living, breathing SVG lung visualization.
   Exposes window.LungViz with:
     mount(hostEl)        -> inject the SVG
     setDamage(0..100)    -> morph color, tar, breathing toward damage
     getState()           -> current rendered damage
   The lungs breathe continuously via requestAnimationFrame so
   both the RATE (labored) and DEPTH (shallow) of breathing can
   react smoothly to the current damage level.
   ============================================================ */
(function () {
  "use strict";

  // Screen-left lung outline (center of viewBox is x=200).
  // The right lung is a mirror of this one.
  var LUNG_PATH =
    "M196 138 C168 130 132 140 110 172 C88 205 76 255 80 306 " +
    "C84 344 104 380 142 384 C172 387 193 372 197 336 L198 150 Z";

  var svgNS = "http://www.w3.org/2000/svg";

  var state = {
    host: null,
    el: {},
    damage: 0,        // target damage
    rendered: 0,      // eased damage actually shown
    phase: 0,         // breathing phase
    last: 0,
    raf: null,
    spots: [],
  };

  function create(tag, attrs) {
    var node = document.createElementNS(svgNS, tag);
    if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  // Deterministic pseudo-random so tar spots are stable between renders.
  function seeded(i) {
    var x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function buildSpots() {
    // Scatter tar/scar blobs across the left lung; mirror handles the right.
    var spots = [];
    for (var i = 0; i < 26; i++) {
      var rx = 88 + seeded(i) * 100;       // within left lung x range
      var ry = 165 + seeded(i + 50) * 205; // within lung y range
      var r = 5 + seeded(i + 99) * 13;
      spots.push({ x: rx, y: ry, r: r, threshold: seeded(i + 7) * 0.7 });
    }
    return spots;
  }

  function mount(host) {
    state.host = host;
    state.spots = buildSpots();

    var svg = create("svg", {
      viewBox: "0 0 400 430",
      width: "100%",
      preserveAspectRatio: "xMidYMid meet",
    });

    // ---- defs: gradients, filters, clip ----
    var defs = create("defs");

    var healthGrad = create("linearGradient", { id: "lvHealth", x1: "0", y1: "0", x2: "0.4", y2: "1" });
    var s1 = create("stop", { offset: "0%", "stop-color": "#ff9fb4" });
    var s2 = create("stop", { offset: "55%", "stop-color": "#ff6f8c" });
    var s3 = create("stop", { offset: "100%", "stop-color": "#e84d72" });
    healthGrad.append(s1, s2, s3);
    defs.append(healthGrad);
    state.el.stops = [s1, s2, s3];

    var glow = create("filter", { id: "lvGlow", x: "-30%", y: "-30%", width: "160%", height: "160%" });
    var blur = create("feGaussianBlur", { stdDeviation: "5", result: "b" });
    var merge = create("feMerge");
    merge.append(create("feMergeNode", { in: "b" }), create("feMergeNode", { in: "SourceGraphic" }));
    glow.append(blur, merge);
    defs.append(glow);

    // Clip path = both lungs, so tar/tint stay inside the organ shapes.
    var clip = create("clipPath", { id: "lvClip" });
    clip.append(create("path", { d: LUNG_PATH }));
    var mirrorClip = create("path", { d: LUNG_PATH, transform: "translate(400,0) scale(-1,1)" });
    clip.append(mirrorClip);
    defs.append(clip);

    svg.append(defs);

    // ---- breathing group (everything that expands) ----
    var breath = create("g", { id: "lvBreath" });
    state.el.breath = breath;

    // Trachea + bronchi
    var airway = create("g", { stroke: "#cdd6f5", "stroke-width": "12", fill: "none", "stroke-linecap": "round", opacity: "0.9" });
    airway.append(create("path", { d: "M200 30 L200 120" }));
    airway.append(create("path", { d: "M200 118 C188 140 168 146 150 156" }));
    airway.append(create("path", { d: "M200 118 C212 140 232 146 250 156" }));
    state.el.airway = airway;

    // Lung bodies
    var leftLung = create("path", { d: LUNG_PATH, fill: "url(#lvHealth)", filter: "url(#lvGlow)" });
    var rightLung = create("path", { d: LUNG_PATH, fill: "url(#lvHealth)", filter: "url(#lvGlow)", transform: "translate(400,0) scale(-1,1)" });
    breath.append(airway, leftLung, rightLung);

    // ---- clipped overlays: healthy alveoli + tar + dark tint ----
    var clipped = create("g", { "clip-path": "url(#lvClip)" });

    // Healthy alveoli sparkle (visible when healthy, fades as damage rises)
    var alveoli = create("g", { fill: "#ffffff", opacity: "0.18" });
    for (var a = 0; a < 18; a++) {
      var ax = 90 + seeded(a + 200) * 100;
      var ay = 165 + seeded(a + 260) * 200;
      alveoli.append(create("circle", { cx: ax, cy: ay, r: 2 + seeded(a + 300) * 2 }));
      alveoli.append(create("circle", { cx: 400 - ax, cy: ay, r: 2 + seeded(a + 300) * 2 }));
    }
    state.el.alveoli = alveoli;

    // Dark tint that deepens with damage
    var tint = create("rect", { x: "0", y: "0", width: "400", height: "430", fill: "#1a1410", opacity: "0" });
    state.el.tint = tint;

    // Tar blobs (left + mirrored right), each revealed past its threshold
    var tarGroup = create("g");
    state.el.tarNodes = [];
    state.spots.forEach(function (sp) {
      var c1 = create("circle", { cx: sp.x, cy: sp.y, r: sp.r, fill: "#241b12", opacity: "0" });
      var c2 = create("circle", { cx: 400 - sp.x, cy: sp.y, r: sp.r * 0.92, fill: "#2c2014", opacity: "0" });
      tarGroup.append(c1, c2);
      state.el.tarNodes.push({ nodes: [c1, c2], threshold: sp.threshold });
    });

    clipped.append(alveoli, tint, tarGroup);
    breath.append(clipped);

    svg.append(breath);
    host.innerHTML = "";
    host.append(svg);

    state.last = performance.now();
    loop(state.last);
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function applyDamage(d) {
    var t = d / 100;

    // Color: healthy pink -> sick grey/brown.
    var pink = [[255,159,180],[255,111,140],[232,77,114]];
    var sick = [[120,108,96],[92,80,66],[64,54,44]];
    state.el.stops.forEach(function (stop, i) {
      var c = [
        Math.round(lerp(pink[i][0], sick[i][0], t)),
        Math.round(lerp(pink[i][1], sick[i][1], t)),
        Math.round(lerp(pink[i][2], sick[i][2], t)),
      ];
      stop.setAttribute("stop-color", "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")");
    });

    // Overlays
    state.el.tint.setAttribute("opacity", (t * 0.55).toFixed(3));
    state.el.alveoli.setAttribute("opacity", (0.18 * (1 - t)).toFixed(3));

    // Tar reveals progressively as damage passes each blob's threshold.
    state.el.tarNodes.forEach(function (item) {
      var reveal = (t - item.threshold) / (1 - item.threshold);
      reveal = Math.max(0, Math.min(1, reveal));
      var op = (reveal * 0.9).toFixed(3);
      item.nodes[0].setAttribute("opacity", op);
      item.nodes[1].setAttribute("opacity", op);
    });

    // Airway discolors slightly
    var airwayShade = Math.round(lerp(205, 120, t));
    state.el.airway.setAttribute("stroke", "rgb(" + airwayShade + "," + airwayShade + "," + Math.round(lerp(245,110,t)) + ")");

    // Drive the global CSS hue (pink ~ 345 healthy is awkward; use teal->red scale)
    var hue = Math.round(lerp(158, 4, t)); // teal -> red
    document.documentElement.style.setProperty("--health-hue", hue);
  }

  function loop(now) {
    var dt = Math.min(0.05, (now - state.last) / 1000);
    state.last = now;

    // Ease rendered damage toward target.
    state.rendered += (state.damage - state.rendered) * Math.min(1, dt * 2.2);
    applyDamage(state.rendered);

    var t = state.rendered / 100;
    // Breathing rate: healthy ~ 0.26 Hz (relaxed), damaged faster + labored.
    var rate = lerp(0.26, 0.62, t);
    // Depth: healthy deep breath, damaged shallow.
    var depth = lerp(0.05, 0.016, t);

    state.phase += dt * rate * Math.PI * 2;
    var s = Math.sin(state.phase);
    // Add a slight catch/irregularity at high damage.
    if (t > 0.6) s += Math.sin(state.phase * 3.1) * 0.18 * (t - 0.6);

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
