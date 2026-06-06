/* ============================================================
   App — orchestrates the experience:
     intro -> adaptive questions (lungs react live) -> results
   Each answer recomputes a 0..100 damage score, which drives
   the breathing lungs, the smoke field, and the health readout.
   ============================================================ */
(function () {
  "use strict";

  var panel = document.getElementById("panel");
  var progress = document.getElementById("progress");
  var healthReadout = document.getElementById("health-readout");
  var healthFill = document.getElementById("health-fill");
  var healthValue = document.getElementById("health-value");
  var statusText = document.getElementById("lungs-status-text");

  // ---- Mount the lungs ----
  LungViz.mount(document.getElementById("lungs-host"));

  // ---------- Questions ----------
  var QUESTIONS = [
    {
      id: "frequency",
      eyebrow: "Your habits",
      title: "How often do you smoke or vape?",
      help: "Be honest — this is just for you.",
      type: "choice",
      options: [
        { value: "never", label: "Never", sub: "I don't smoke or vape", icon: "\uD83C\uDF3F" },
        { value: "former", label: "I quit", sub: "Former smoker", icon: "\u23F1\uFE0F" },
        { value: "occasional", label: "Occasionally", sub: "Socially / now and then", icon: "\uD83C\uDF19" },
        { value: "daily", label: "Every day", sub: "A daily habit", icon: "\uD83D\uDD25" },
      ],
    },
    {
      id: "product",
      eyebrow: "Your habits",
      title: "What do you use most?",
      help: "Different products carry different risks.",
      type: "choice",
      skipIf: function (a) { return a.frequency === "never"; },
      options: [
        { value: "cigarettes", label: "Cigarettes", sub: "Factory or rolled", icon: "\uD83D\uDEAC" },
        { value: "vape", label: "Vape / e-cig", sub: "Nicotine vapor", icon: "\uD83D\uDCA8" },
        { value: "cigar", label: "Cigars / pipe", sub: "Heavier tar", icon: "\uD83E\uDEA8" },
        { value: "shisha", label: "Shisha / hookah", sub: "Waterpipe", icon: "\u267B\uFE0F" },
      ],
    },
    {
      id: "perDay",
      eyebrow: "Your habits",
      title: "How much on a typical day?",
      help: "Cigarettes (or puffs/sessions) per day.",
      type: "slider",
      min: 0, max: 40, step: 1, def: 10, unit: "/ day",
      skipIf: function (a) { return a.frequency === "never"; },
    },
    {
      id: "years",
      eyebrow: "Time",
      title: "For how many years?",
      help: "Across your whole life, roughly.",
      type: "slider",
      min: 0, max: 50, step: 1, def: 8, unit: "years",
      skipIf: function (a) { return a.frequency === "never"; },
    },
    {
      id: "startAge",
      eyebrow: "Time",
      title: "What age did you start?",
      help: "Starting younger affects developing lungs more.",
      type: "slider",
      min: 10, max: 40, step: 1, def: 18, unit: "yrs old",
      skipIf: function (a) { return a.frequency === "never"; },
    },
    {
      id: "exposure",
      eyebrow: "Environment",
      title: "Around secondhand smoke often?",
      help: "At home, work, or with friends.",
      type: "choice",
      options: [
        { value: "no", label: "Rarely", sub: "Mostly clean air", icon: "\uD83C\uDF2C\uFE0F" },
        { value: "some", label: "Sometimes", sub: "Now and then", icon: "\uD83C\uDFD9\uFE0F" },
        { value: "yes", label: "Very often", sub: "Daily exposure", icon: "\uD83C\uDFED" },
      ],
    },
    {
      id: "exercise",
      eyebrow: "Lifestyle",
      title: "How often do you exercise?",
      help: "Cardio helps your lungs stay strong.",
      type: "choice",
      options: [
        { value: "often", label: "Often", sub: "3+ times a week", icon: "\uD83C\uDFC3" },
        { value: "sometimes", label: "Sometimes", sub: "Once in a while", icon: "\uD83D\uDEB6" },
        { value: "never", label: "Rarely", sub: "Mostly sedentary", icon: "\uD83D\uDECB\uFE0F" },
      ],
    },
    {
      id: "symptoms",
      eyebrow: "Signals",
      title: "Cough or shortness of breath?",
      help: "Your body's early warning system.",
      type: "choice",
      options: [
        { value: "none", label: "Never", sub: "Breathing feels easy", icon: "\u2728" },
        { value: "sometimes", label: "Sometimes", sub: "After stairs or effort", icon: "\uD83D\uDE2E\u200D\uD83D\uDCA8" },
        { value: "often", label: "Often", sub: "Daily cough / wheeze", icon: "\uD83E\uDEC1" },
      ],
    },
  ];

  // ---------- State ----------
  var state = {
    screen: "intro",
    step: 0,
    answers: {
      perDay: 10, years: 8, startAge: 18, // slider defaults
    },
  };

  function visibleQuestions() {
    return QUESTIONS.filter(function (q) {
      return !(q.skipIf && q.skipIf(state.answers));
    });
  }

  // ---------- Scoring engine ----------
  function computeDamage(a) {
    var breakdown = [];
    var add = function (label, v) { if (v) breakdown.push({ label: label, value: Math.round(v) }); };

    var smokes = a.frequency && a.frequency !== "never";
    var perDay = smokes ? (a.perDay || 0) : 0;
    var years = smokes ? (a.years || 0) : 0;

    // Product weighting (relative tar/risk per unit).
    var prodWeight = { cigarettes: 1, vape: 0.45, cigar: 1.25, shisha: 1.1 }[a.product] || 1;

    // Frequency baseline.
    var freqBase = { former: 6, occasional: 12, daily: 22 }[a.frequency] || 0;
    add("Smoking frequency", freqBase);

    // Pack-years — the core clinical measure.
    var packYears = (perDay / 20) * years * prodWeight;
    var pyDamage = Math.min(46, packYears * 2.3);
    add("Pack-years exposure", pyDamage);

    // Former smokers' lungs partially recover over time.
    if (a.frequency === "former") { pyDamage *= 0.6; }

    // Starting young.
    var startDmg = 0;
    if (smokes) {
      if (a.startAge <= 15) startDmg = 9;
      else if (a.startAge <= 19) startDmg = 5;
      else startDmg = 2;
    }
    add("Early start age", startDmg);

    // Secondhand exposure.
    var exp = { some: 4, yes: 9 }[a.exposure] || 0;
    add("Secondhand smoke", exp);

    // Exercise (protective / aggravating).
    var ex = { often: -6, sometimes: -1, never: 6 }[a.exercise] || 0;
    add("Fitness level", ex);

    // Symptoms.
    var sym = { sometimes: 7, often: 16 }[a.symptoms] || 0;
    add("Reported symptoms", sym);

    var total = freqBase + pyDamage + startDmg + exp + ex + sym;
    // Small environmental baseline so nobody is a perfect 0.
    total += 3;
    total = Math.max(0, Math.min(100, total));

    return { total: total, breakdown: breakdown, packYears: packYears, perDay: perDay, years: years };
  }

  // ---------- Live feedback (lungs + smoke + readout) ----------
  function statusFor(d) {
    if (d < 12) return "Calm, steady breathing";
    if (d < 30) return "Light, mostly clear breaths";
    if (d < 50) return "Breathing a little tighter";
    if (d < 70) return "Labored, congested airflow";
    return "Heavy, struggling breaths";
  }

  function updateFeedback() {
    var d = computeDamage(state.answers).total;
    LungViz.setDamage(d);
    if (window.Smoke) Smoke.setIntensity(d / 100);

    var health = Math.round(100 - d);
    healthFill.style.width = health + "%";
    healthFill.style.backgroundPosition = (100 - health) + "% 0";
    healthValue.textContent = health + "%";
    healthValue.style.color = "hsl(var(--health-hue) 90% 65%)";
    statusText.textContent = statusFor(d);
  }

  // ---------- Rendering ----------
  function transition(html, after) {
    var current = panel.firstElementChild;
    var done = function () {
      panel.innerHTML = html;
      if (after) after();
    };
    if (current) {
      current.classList.add("card--out");
      setTimeout(done, 300);
    } else {
      done();
    }
  }

  function renderIntro() {
    healthReadout.hidden = true;
    progress.hidden = true;
    LungViz.setDamage(0);
    if (window.Smoke) Smoke.setIntensity(0.12);
    statusText.textContent = "Calm, steady breathing";

    transition(
      '<div class="card fade-stagger">' +
        '<p class="eyebrow">An interactive lung-health journey</p>' +
        '<h1 class="title">See your lungs respond to <span class="grad">every choice</span> you make.</h1>' +
        '<p class="lede">Answer a few simple questions. With each one, the living lungs above shift, ' +
        'darken, and breathe differently — a vivid mirror of how smoking shapes the air you live on. ' +
        'No sign-up. Nothing leaves your device.</p>' +
        '<div class="actions">' +
          '<span></span>' +
          '<button class="btn btn--primary btn--lg" id="start-btn">Begin the journey \u2192</button>' +
        '</div>' +
      '</div>',
      function () {
        document.getElementById("start-btn").onclick = function () {
          state.screen = "questions";
          state.step = 0;
          renderStep();
        };
      }
    );
  }

  function renderProgress() {
    var qs = visibleQuestions();
    progress.hidden = false;
    progress.innerHTML = "";
    qs.forEach(function (_, i) {
      var dot = document.createElement("span");
      dot.className = "progress__dot" + (i === state.step ? " is-active" : i < state.step ? " is-done" : "");
      progress.append(dot);
    });
  }

  function renderStep() {
    var qs = visibleQuestions();
    if (state.step >= qs.length) { renderResults(); return; }

    healthReadout.hidden = false;
    var q = qs[state.step];
    updateFeedback();
    renderProgress();

    var body;
    if (q.type === "choice") body = choiceMarkup(q);
    else body = sliderMarkup(q);

    var isLast = state.step === qs.length - 1;
    var nextLabel = isLast ? "See my results \u2192" : "Continue \u2192";

    var html =
      '<div class="card">' +
        '<p class="q-count">Question ' + (state.step + 1) + " of " + qs.length + '</p>' +
        '<h2 class="q-title">' + q.title + "</h2>" +
        '<p class="q-help">' + q.help + "</p>" +
        body +
        '<div class="actions">' +
          '<button class="btn btn--ghost" id="back-btn"' + (state.step === 0 ? " disabled" : "") + ">\u2190 Back</button>" +
          '<button class="btn btn--primary" id="next-btn">' + nextLabel + "</button>" +
        "</div>" +
      "</div>";

    transition(html, function () { wireStep(q, isLast); });
  }

  function choiceMarkup(q) {
    var cols = q.options.length === 4 ? " cols-2" : "";
    var current = state.answers[q.id];
    var opts = q.options.map(function (o) {
      var sel = current === o.value ? " is-selected" : "";
      return (
        '<button class="option' + sel + '" data-value="' + o.value + '">' +
          '<span class="option__icon">' + o.icon + "</span>" +
          '<span class="option__body">' +
            '<span class="option__label">' + o.label + "</span>" +
            '<span class="option__sub">' + o.sub + "</span>" +
          "</span>" +
        "</button>"
      );
    }).join("");
    return '<div class="options' + cols + '">' + opts + "</div>";
  }

  function sliderMarkup(q) {
    var val = state.answers[q.id] != null ? state.answers[q.id] : q.def;
    state.answers[q.id] = val;
    var pct = ((val - q.min) / (q.max - q.min)) * 100;
    return (
      '<div class="slider-wrap">' +
        '<div><span class="slider-value" id="slider-val">' + val + '</span><span class="slider-unit">' + q.unit + "</span></div>" +
        '<input class="range" type="range" id="range" min="' + q.min + '" max="' + q.max + '" step="' + q.step + '" value="' + val + '" style="--p:' + pct + '%">' +
        '<div class="range-scale"><span>' + q.min + "</span><span>" + q.max + (q.max === 40 ? "+" : "") + "</span></div>" +
      "</div>"
    );
  }

  function wireStep(q, isLast) {
    var nextBtn = document.getElementById("next-btn");
    var backBtn = document.getElementById("back-btn");

    backBtn.onclick = function () {
      if (state.step > 0) { state.step--; renderStep(); }
    };
    nextBtn.onclick = function () {
      // Re-evaluate visibility (frequency may have changed the set).
      state.step++;
      renderStep();
    };

    if (q.type === "choice") {
      // Require a choice before continuing if none selected.
      if (state.answers[q.id] == null) nextBtn.disabled = true;
      var buttons = panel.querySelectorAll(".option");
      buttons.forEach(function (b) {
        b.onclick = function () {
          buttons.forEach(function (x) { x.classList.remove("is-selected"); });
          b.classList.add("is-selected");
          state.answers[q.id] = b.getAttribute("data-value");
          updateFeedback();
          nextBtn.disabled = false;
          // Gentle auto-advance for momentum.
          setTimeout(function () {
            if (state.screen === "questions") { state.step++; renderStep(); }
          }, 520);
        };
      });
    } else {
      var range = document.getElementById("range");
      var valEl = document.getElementById("slider-val");
      range.oninput = function () {
        var v = parseInt(range.value, 10);
        state.answers[q.id] = v;
        valEl.textContent = v;
        range.style.setProperty("--p", ((v - q.min) / (q.max - q.min)) * 100 + "%");
        updateFeedback();
      };
    }
  }

  // ---------- Results ----------
  function verdictFor(d) {
    if (d < 12) return { t: "Clear & Resilient", c: "var(--good)", s: "Your lungs look healthy and full of capacity. Keep protecting them." };
    if (d < 30) return { t: "Mostly Healthy", c: "var(--good-2)", s: "Largely in good shape, with a little room to improve your habits and environment." };
    if (d < 50) return { t: "Early Strain", c: "var(--warn)", s: "Signs of early wear are showing. The good news: lungs are remarkably good at recovering." };
    if (d < 70) return { t: "Significant Damage", c: "var(--bad)", s: "Your lungs are working hard against real strain. Cutting back now changes your trajectory fast." };
    return { t: "Severe Risk", c: "var(--bad-2)", s: "This level of exposure is taking a serious toll. It's never too late — every smoke-free day helps." };
  }

  function buildInsights(r, a) {
    var out = [];
    if (a.frequency === "never") {
      out.push(["\uD83C\uDF3F", "<strong>You don't smoke</strong> — the single best thing you can do for your lungs. You've avoided ~90% of preventable lung-cancer risk."]);
    }
    if (r.packYears >= 1) {
      out.push(["\uD83D\uDCCA", "You've accumulated about <strong>" + r.packYears.toFixed(1) + " pack-years</strong>. Doctors use this number to gauge long-term smoking risk."]);
    }
    if (a.exercise === "often") {
      out.push(["\uD83C\uDFC3", "<strong>Regular cardio</strong> is boosting your lung capacity and helping clear your airways."]);
    } else if (a.exercise === "never") {
      out.push(["\uD83D\uDECB\uFE0F", "Adding even light <strong>daily cardio</strong> can measurably improve how efficiently your lungs work."]);
    }
    if (a.symptoms === "often") {
      out.push(["\uD83E\uDEC1", "A persistent cough or breathlessness is worth discussing with a doctor — early checks matter."]);
    }
    if (a.exposure === "yes") {
      out.push(["\uD83C\uDFED", "<strong>Frequent secondhand smoke</strong> damages lungs even if you don't smoke yourself. Cleaner air helps quickly."]);
    }
    if (a.frequency && a.frequency !== "never") {
      out.push(["\u23F3", "Within <strong>20 minutes</strong> of quitting, heart rate drops; within a year, lung function climbs noticeably."]);
    }
    return out.slice(0, 4);
  }

  function renderResults() {
    state.screen = "results";
    progress.hidden = true;
    var r = computeDamage(state.answers);
    var a = state.answers;
    var d = Math.round(r.total);
    LungViz.setDamage(d);
    if (window.Smoke) Smoke.setIntensity(d / 100);
    updateFeedbackStatic(d);

    var v = verdictFor(d);
    var insights = buildInsights(r, a);
    var health = 100 - d;
    var circ = 2 * Math.PI * 86;

    var insightHtml = insights.map(function (it) {
      return '<div class="insight"><span class="insight__icon">' + it[0] + '</span><span class="insight__text">' + it[1] + "</span></div>";
    }).join("");

    var smokes = a.frequency && a.frequency !== "never";
    var cigsYear = smokes ? Math.round((a.perDay || 0) * 365) : 0;

    var html =
      '<div class="card fade-stagger">' +
        '<div class="result-head">' +
          '<p class="eyebrow">Your lung snapshot</p>' +
          '<div class="gauge">' +
            "<svg viewBox=\"0 0 200 200\">" +
              '<circle cx="100" cy="100" r="86" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="14"/>' +
              '<circle id="gauge-arc" cx="100" cy="100" r="86" fill="none" stroke="' + v.c + '" stroke-width="14" stroke-linecap="round" ' +
                'stroke-dasharray="' + circ + '" stroke-dashoffset="' + circ + '" style="transition: stroke-dashoffset 1.4s cubic-bezier(0.22,1,0.36,1)"/>' +
            "</svg>" +
            '<div class="gauge__center"><div><div class="gauge__num" style="color:' + v.c + '">' + d + "%</div><div class=\"gauge__cap\">Est. damage</div></div></div>" +
          "</div>" +
          '<h2 class="verdict" style="color:' + v.c + '">' + v.t + "</h2>" +
          '<p class="verdict-sub">' + v.s + "</p>" +
        "</div>" +
        '<div class="stat-grid">' +
          '<div class="stat"><div class="stat__num">' + r.packYears.toFixed(1) + '</div><div class="stat__label">Pack-years</div></div>' +
          '<div class="stat"><div class="stat__num">' + cigsYear.toLocaleString() + '</div><div class="stat__label">Cigs / year</div></div>' +
          '<div class="stat"><div class="stat__num" style="color:hsl(var(--health-hue) 90% 65%)">' + health + '%</div><div class="stat__label">Lung health</div></div>' +
        "</div>" +
        '<div class="insights">' + insightHtml + "</div>" +
        '<div class="resources">' +
          "<h4>Lungs heal — faster than you'd think</h4>" +
          "<p>If you smoke, quitting at any age adds healthy years. Free, confidential help is available: call a quitline " +
          "(in the US, <strong>1-800-QUIT-NOW</strong>) or visit " +
          '<a href="https://www.cdc.gov/tobacco/" target="_blank" rel="noopener">cdc.gov/tobacco</a>. ' +
          "Talk to a doctor about any lasting cough or breathlessness.</p>" +
        "</div>" +
        '<div class="result-actions">' +
          '<button class="btn btn--primary btn--lg" id="again-btn">Try different answers</button>' +
          '<button class="btn btn--ghost" id="restart-btn">Start over</button>' +
        "</div>" +
      "</div>";

    transition(html, function () {
      // Animate the gauge arc.
      requestAnimationFrame(function () {
        var arc = document.getElementById("gauge-arc");
        if (arc) arc.setAttribute("stroke-dashoffset", String(circ * (1 - d / 100)));
      });
      document.getElementById("again-btn").onclick = function () {
        state.screen = "questions";
        state.step = 0;
        renderStep();
      };
      document.getElementById("restart-btn").onclick = function () {
        state.answers = { perDay: 10, years: 8, startAge: 18 };
        state.screen = "intro";
        renderIntro();
      };
    });
  }

  function updateFeedbackStatic(d) {
    healthReadout.hidden = false;
    var health = Math.round(100 - d);
    healthFill.style.width = health + "%";
    healthFill.style.backgroundPosition = (100 - health) + "% 0";
    healthValue.textContent = health + "%";
    healthValue.style.color = "hsl(var(--health-hue) 90% 65%)";
    statusText.textContent = statusFor(d);
  }

  // ---------- Boot ----------
  renderIntro();
})();
