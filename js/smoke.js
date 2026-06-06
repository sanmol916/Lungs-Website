/* ============================================================
   Smoke — ambient particle field rendered on a full-screen
   canvas. Intensity rises with lung damage so the scene grows
   smokier as choices accumulate. Lightweight and DPR-aware.
   ============================================================ */
(function () {
  "use strict";

  var canvas = document.getElementById("smoke-canvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  var W = 0, H = 0, dpr = 1;
  var particles = [];
  var MAX = 70;
  var intensity = 0.1; // 0..1, set by app via window.Smoke.setIntensity
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn() {
    return {
      x: Math.random() * W,
      y: H + Math.random() * 120,
      r: 30 + Math.random() * 90,
      vy: -(0.15 + Math.random() * 0.5),
      vx: (Math.random() - 0.5) * 0.3,
      life: 0,
      max: 600 + Math.random() * 700,
      hue: 200 + Math.random() * 60,
    };
  }

  function tick() {
    ctx.clearRect(0, 0, W, H);

    var target = Math.floor(MAX * (0.2 + intensity * 0.8));
    while (particles.length < target) particles.push(spawn());

    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life++;
      p.y += p.vy * (1 + intensity);
      p.x += p.vx + Math.sin((p.life + i) * 0.01) * 0.3;
      p.r += 0.15;

      var fade = Math.sin((p.life / p.max) * Math.PI); // ease in & out
      var alpha = fade * (0.04 + intensity * 0.12);

      if (p.life > p.max || p.y < -p.r) {
        particles.splice(i, 1);
        continue;
      }

      var grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      // Color shifts from cool teal (clean) to grey-brown (smoky).
      var col = intensity < 0.5
        ? "60,180,200"
        : "150,140,130";
      grad.addColorStop(0, "rgba(" + col + "," + alpha.toFixed(3) + ")");
      grad.addColorStop(1, "rgba(" + col + ",0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(tick);
  }

  window.addEventListener("resize", resize);
  resize();
  if (!reduced) {
    for (var i = 0; i < 18; i++) particles.push(spawn());
    tick();
  }

  window.Smoke = {
    setIntensity: function (v) { intensity = Math.max(0, Math.min(1, v)); },
  };
})();
