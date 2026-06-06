/* ============================================================
   Smoke — lightweight ambient particle field.

   Performance: a single soft-circle sprite is rendered ONCE to
   an offscreen canvas, then stamped with drawImage + globalAlpha.
   No per-particle gradient allocation each frame. Particle count
   is modest and the loop pauses when the tab is hidden.
   ============================================================ */
(function () {
  "use strict";

  var canvas = document.getElementById("smoke-canvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  var W = 0, H = 0, dpr = 1;
  var particles = [];
  var MAX = 34;
  var intensity = 0.12;
  var running = false;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Pre-rendered soft circle sprite.
  var sprite = document.createElement("canvas");
  sprite.width = sprite.height = 128;
  (function () {
    var sc = sprite.getContext("2d");
    var g = sc.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    sc.fillStyle = g;
    sc.beginPath();
    sc.arc(64, 64, 64, 0, Math.PI * 2);
    sc.fill();
  })();

  function resize() {
    dpr = Math.min(1.75, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn() {
    return {
      x: Math.random() * W,
      y: H + Math.random() * 120,
      r: 40 + Math.random() * 90,
      vy: -(0.12 + Math.random() * 0.4),
      vx: (Math.random() - 0.5) * 0.25,
      life: 0,
      max: 520 + Math.random() * 620,
    };
  }

  function tick() {
    if (!running) return;
    ctx.clearRect(0, 0, W, H);

    var target = Math.round(MAX * (0.25 + intensity * 0.75));
    if (particles.length < target) particles.push(spawn());

    var clean = intensity < 0.5;
    // Tint the white sprite via globalCompositeOperation-free approach:
    // draw sprite, then a single tint pass is skipped for speed; instead
    // we just vary alpha. A subtle hue is applied through canvas filter.
    ctx.globalCompositeOperation = "lighter";

    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life++;
      p.y += p.vy * (1 + intensity);
      p.x += p.vx;
      p.r += 0.12;

      if (p.life > p.max || p.y < -p.r) { particles.splice(i, 1); continue; }

      var fade = Math.sin((p.life / p.max) * Math.PI);
      ctx.globalAlpha = fade * (0.035 + intensity * 0.09);
      var d = p.r * 2;
      ctx.drawImage(sprite, p.x - p.r, p.y - p.r, d, d);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // Cool teal vs smoky grey overlay tint, drawn once per frame (cheap).
    ctx.fillStyle = clean ? "rgba(40,150,170,0.0)" : "rgba(150,140,130,0.02)";
    if (!clean) ctx.fillRect(0, 0, W, H);

    requestAnimationFrame(tick);
  }

  function start() {
    if (running || reduced) return;
    running = true;
    if (particles.length === 0) for (var i = 0; i < 14; i++) particles.push(spawn());
    requestAnimationFrame(tick);
  }
  function stop() { running = false; }

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });

  resize();
  start();

  window.Smoke = {
    setIntensity: function (v) { intensity = Math.max(0, Math.min(1, v)); },
  };
})();
