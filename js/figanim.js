/* FigAnim: animated data figures for the scroll reading mode.

   For the figures that are data graphics, the book image is replaced by an inline SVG that comes to rest
   identical to the printed figure, and animates in once when it is scrolled into view.

   Classic script, no dependencies, works from file://.

     FigAnim.attach(figureEl, svgText, opts?)  replace the figure's image with the SVG and arm the animation.
                                               Returns a controller {svg, play(), finish(), reset()} or null.
     FigAnim.attachAll(root, getText, config)  for every id in config ({ "fig-1-2": {"svg": "...", "mode": "..."} })
                                               found under root, fetch the SVG text through getText(path)
                                               (a Promise, e.g. the vault's getAsset) shortly before the figure
                                               nears the viewport, then attach it.
     FigAnim.fontBase                          URL prefix for the bundled figure fonts (default "fonts/").
     FigAnim.finishAll()                       jump every armed figure to its final state (used before print).

   The SVGs are tagged with data-fa attributes (see figanim-test/src/figlib.py):
     t / bg  fade in first         dots  staggered fade, row by row      bar  grows from its baseline (data-fa-o)
     line    draws in              area  fades with the marks            mark annotations, land last
     n       number that counts up (data-fa-ride: travels with the bar whose data-fa-k matches)
   Untagged SVGs are tagged heuristically from opts.mode.

   Motion: ≤ 1.4 s in total, cubic-bezier(.2,.7,.2,1), no overshoot. When <html data-motion="reduce"> or
   prefers-reduced-motion, the figure is shown at rest immediately. The SVG takes the image's exact aspect
   ratio before anything animates, so there is no layout shift. The <a class="zoom"> link is kept, so the
   lightbox still opens the book image. */
(function () {
  "use strict";

  var TOTAL = 1400;           // hard ceiling for any figure, ms
  var MARKS_AT = 200;         // marks start after the scaffolding has begun to fade in
  var SVGNS = "http://www.w3.org/2000/svg";
  var armed = [];
  var uid = 0;

  /* cubic-bezier(.2,.7,.2,1) */
  function bezier(p1x, p1y, p2x, p2y) {
    var cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
    var cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
    function sx(t) { return ((ax * t + bx) * t + cx) * t; }
    function sy(t) { return ((ay * t + by) * t + cy) * t; }
    function dx(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x, i, d;
      for (i = 0; i < 6; i++) { d = sx(t) - x; if (Math.abs(d) < 1e-5) break; var s = dx(t); if (Math.abs(s) < 1e-6) break; t -= d / s; }
      if (t < 0 || t > 1) { var lo = 0, hi = 1; t = x; for (i = 0; i < 20; i++) { if (sx(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
      return sy(t);
    };
  }
  var ease = bezier(0.2, 0.7, 0.2, 1);

  function reduced() {
    var de = document.documentElement;
    if (de && de.dataset && de.dataset.motion === "reduce") return true;
    try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ fonts */
  var FONTS = [
    ["FA Poppins", "poppins", [400, 500, 600, 700], []],
    ["FA Arimo", "arimo", [400, 500, 600, 700], [400, 500]],
    ["FA Inter", "inter", [400, 500, 600, 700], []]
  ];
  function ensureFonts() {
    if (document.getElementById("figanim-fonts")) return;
    var base = FigAnim.fontBase, css = "";
    FONTS.forEach(function (f) {
      f[2].forEach(function (w) { css += "@font-face{font-family:'" + f[0] + "';font-style:normal;font-weight:" + w + ";font-display:swap;src:url('" + base + "fig-" + f[1] + "-latin-" + w + "-normal.woff2') format('woff2')}\n"; });
      f[3].forEach(function (w) { css += "@font-face{font-family:'" + f[0] + "';font-style:italic;font-weight:" + w + ";font-display:swap;src:url('" + base + "fig-" + f[1] + "-latin-" + w + "-italic.woff2') format('woff2')}\n"; });
    });
    css += "svg.figanim-svg{display:block;width:100%;height:auto;max-width:100%;overflow:hidden}\n";
    var st = document.createElement("style");
    st.id = "figanim-fonts";
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------------------ parsing */
  function parseSvg(text) {
    var doc = new DOMParser().parseFromString(text, "image/svg+xml");
    var svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) return null;
    // defensive clean-up: nothing executable, nothing external
    Array.prototype.slice.call(svg.querySelectorAll("script, foreignObject")).forEach(function (n) { n.parentNode.removeChild(n); });
    Array.prototype.slice.call(svg.querySelectorAll("*")).concat([svg]).forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        var name = a.name.toLowerCase();
        if (name.indexOf("on") === 0) n.removeAttribute(a.name);
        else if ((name === "href" || name === "xlink:href") && !/^(#|data:image\/(png|jpeg|webp);)/i.test(a.value)) n.removeAttribute(a.name);
      });
    });
    return document.importNode(svg, true);
  }

  function viewBox(svg) {
    var vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return vb;
    var w = parseFloat(svg.getAttribute("width")) || 100, h = parseFloat(svg.getAttribute("height")) || 100;
    return [0, 0, w, h];
  }

  /* heuristic tagging for an SVG that carries no data-fa attributes */
  function autoTag(svg, mode) {
    var vb = viewBox(svg), W = vb[2], H = vb[3];
    Array.prototype.forEach.call(svg.querySelectorAll("text"), function (t) { t.setAttribute("data-fa", "t"); });
    Array.prototype.forEach.call(svg.querySelectorAll("line, polyline, path"), function (p) {
      var stroke = p.getAttribute("stroke"), fill = p.getAttribute("fill");
      if (stroke && stroke !== "none" && (!fill || fill === "none")) p.setAttribute("data-fa", /line/.test(mode) ? "line" : "t");
    });
    if (/dots/.test(mode)) {
      var rows = {};
      Array.prototype.forEach.call(svg.querySelectorAll("circle"), function (c) { var k = Math.round(+c.getAttribute("cy")); (rows[k] = rows[k] || []).push(c); });
      Object.keys(rows).map(Number).sort(function (a, b) { return a - b; }).forEach(function (k, i) {
        rows[k].forEach(function (c) { c.setAttribute("data-fa", "dots"); c.setAttribute("data-fa-i", i); });
      });
    }
    if (/bars/.test(mode)) {
      var horiz = /bars-x/.test(mode);
      Array.prototype.forEach.call(svg.querySelectorAll("rect"), function (r) {
        var w = +r.getAttribute("width") || 0, h = +r.getAttribute("height") || 0, fill = (r.getAttribute("fill") || "").toLowerCase();
        if (!w || !h || fill === "none" || fill === "#fff" || fill === "#ffffff" || (w > W * 0.9 && h > H * 0.9)) return;
        if (horiz ? h < H * 0.08 : w < W * 0.08) {
          r.setAttribute("data-fa", "bar"); r.setAttribute("data-fa-o", horiz ? "l" : "b");
          r.setAttribute("data-fa-i", horiz ? +r.getAttribute("y") : +r.getAttribute("x"));
        }
      });
    }
  }

  /* ------------------------------------------------------------------ tracks */
  function num(el, a) { return parseFloat(el.getAttribute(a)) || 0; }

  function countParts(text) {
    var m = /^([^\d]*?)(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(text);
    if (!m) return null;
    var raw = m[2], dec = raw.indexOf(".") >= 0 ? raw.length - raw.indexOf(".") - 1 : 0;
    return { pre: m[1], val: parseFloat(raw.replace(/,/g, "")), dec: dec, comma: raw.indexOf(",") >= 0, post: m[3] };
  }
  function fmt(p, v) {
    var s = v.toFixed(p.dec);
    if (p.comma) { var parts = s.split("."); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); s = parts.join("."); }
    return p.pre + s + p.post;
  }

  function buildTracks(svg, opts) {
    var els = Array.prototype.slice.call(svg.querySelectorAll("[data-fa]"));
    var marksI = els.filter(function (e) { return /^(bar|dots|line|area|n|mark)$/.test(e.getAttribute("data-fa")) && e.hasAttribute("data-fa-i"); })
      .map(function (e) { return parseFloat(e.getAttribute("data-fa-i")) || 0; });
    var imin = marksI.length ? Math.min.apply(null, marksI) : 0, imax = marksI.length ? Math.max.apply(null, marksI) : 0;
    function norm(e) { var i = parseFloat(e.getAttribute("data-fa-i")); if (isNaN(i) || imax === imin) return 0; return (i - imin) / (imax - imin); }
    var spread = opts.spread != null ? +opts.spread : 640;
    var barDur = opts.barDur != null ? +opts.barDur : 520;
    var bars = {}, tracks = [];

    function clampRaw(delay, dur) { if (delay + dur > TOTAL) { if (dur > TOTAL - delay) dur = Math.max(120, TOTAL - delay); if (delay + dur > TOTAL) delay = TOTAL - dur; } return [delay, dur]; }
    var current = null;  // element whose timing is being resolved; data-fa-d / data-fa-dur override the defaults
    function clamp(delay, dur) {
      if (current) {
        if (current.hasAttribute("data-fa-d")) delay = +current.getAttribute("data-fa-d");
        if (current.hasAttribute("data-fa-dur")) dur = +current.getAttribute("data-fa-dur");
      }
      return clampRaw(delay, dur);
    }
    function opacityTrack(e, delay, dur) {
      var keep = e.style.opacity;
      var to = e.hasAttribute("opacity") ? parseFloat(e.getAttribute("opacity")) || 0 : 1;  // style beats the attribute
      var tr = clamp(delay, dur);
      tracks.push({ el: e, delay: tr[0], dur: tr[1], hide: function () { e.style.opacity = "0"; },
        step: function (p) { e.style.opacity = String(to * p); }, done: function () { e.style.opacity = keep; } });
    }

    els.forEach(function (e) {
      var kind = e.getAttribute("data-fa"), n = norm(e), tag = e.tagName.toLowerCase();
      current = e;
      if (kind === "bg") opacityTrack(e, 0, 280);
      else if (kind === "t") opacityTrack(e, 60, 320);
      else if (kind === "dots") opacityTrack(e, MARKS_AT + n * (spread + 160), 220);
      else if (kind === "area") opacityTrack(e, MARKS_AT + 120 + n * 240, 620);
      else if (kind === "mark") opacityTrack(e, MARKS_AT + 560 + n * 360, 280);
      else if (kind === "line") {
        var len = 0;
        try { len = e.getTotalLength(); } catch (err) { len = 0; }
        if (!len) { opacityTrack(e, MARKS_AT, 400); return; }
        var da = e.getAttribute("stroke-dasharray"), dof = e.getAttribute("stroke-dashoffset");
        var tl = clamp(MARKS_AT + n * 260, opts.lineDur != null ? +opts.lineDur : 880);
        tracks.push({ el: e, delay: tl[0], dur: tl[1],
          hide: function () { e.setAttribute("stroke-dasharray", len + " " + len); e.setAttribute("stroke-dashoffset", len); },
          step: function (p) { e.setAttribute("stroke-dashoffset", len * (1 - p)); },
          done: function () { if (da == null) e.removeAttribute("stroke-dasharray"); else e.setAttribute("stroke-dasharray", da); if (dof == null) e.removeAttribute("stroke-dashoffset"); else e.setAttribute("stroke-dashoffset", dof); } });
      } else if (kind === "bar" && tag === "rect") {
        var o = e.getAttribute("data-fa-o") || "b";
        var x = num(e, "x"), y = num(e, "y"), w = num(e, "width"), h = num(e, "height");
        var tb = clamp(MARKS_AT + n * spread, barDur);
        var bar = { el: e, o: o, w: w, h: h, p: 1, delay: tb[0], dur: tb[1] };
        var k = e.getAttribute("data-fa-k"); if (k != null) bars[k] = bar;
        var keepOp = e.style.opacity;
        var set = function (p) {
          bar.p = p;
          if (o === "l") e.setAttribute("width", w * p);
          else if (o === "r") { e.setAttribute("x", x + w * (1 - p)); e.setAttribute("width", w * p); }
          else if (o === "t") e.setAttribute("height", h * p);
          else { e.setAttribute("y", y + h * (1 - p)); e.setAttribute("height", h * p); }
          e.style.opacity = p < 1 ? String(Math.min(1, p * 8)) : keepOp;
        };
        tracks.push({ el: e, delay: bar.delay, dur: bar.dur, hide: function () { set(0); }, step: set,
          done: function () { e.setAttribute("x", x); e.setAttribute("y", y); e.setAttribute("width", w); e.setAttribute("height", h); e.style.opacity = keepOp; } });
      } else if (kind === "bar") opacityTrack(e, MARKS_AT + n * spread, barDur);
    });

    // numbers: count up, riding with their bar when asked
    els.forEach(function (e) {
      if (e.getAttribute("data-fa") !== "n") return;
      current = e;
      var parts = countParts(e.textContent.trim());
      var rideKey = e.getAttribute("data-fa-ride"), bar = rideKey != null ? bars[rideKey] : null;
      var delay = bar ? bar.delay : MARKS_AT + norm(e) * spread, dur = bar ? bar.dur : 700;
      var tc = clamp(delay, dur);
      var original = e.textContent, tl = e.getAttribute("textLength"), keepT = e.getAttribute("transform");
      var keepOp = e.style.opacity;
      tracks.push({ el: e, delay: tc[0], dur: tc[1],
        hide: function () { e.style.opacity = "0"; if (tl != null) e.removeAttribute("textLength"); if (parts) e.textContent = fmt(parts, 0); },
        step: function (p) {
          e.style.opacity = String(Math.min(1, p * 5));
          if (parts) e.textContent = fmt(parts, parts.val * p);
          if (bar) {
            var off = bar.o === "l" ? -(bar.w * (1 - bar.p)) : bar.o === "r" ? bar.w * (1 - bar.p) : 0;
            var offy = bar.o === "b" ? bar.h * (1 - bar.p) : bar.o === "t" ? -(bar.h * (1 - bar.p)) : 0;
            e.setAttribute("transform", (keepT ? keepT + " " : "") + "translate(" + off.toFixed(2) + " " + offy.toFixed(2) + ")");
          }
        },
        done: function () { e.textContent = original; if (tl != null) e.setAttribute("textLength", tl); if (keepT == null) e.removeAttribute("transform"); else e.setAttribute("transform", keepT); e.style.opacity = keepOp; } });
    });
    current = null;
    tracks.forEach(function (t) { t.ease = t.el.getAttribute("data-fa-ease") === "linear" ? function (p) { return p; } : ease; });
    return tracks;
  }

  /* ------------------------------------------------------------------ controller */
  function Controller(fig, svg, opts) {
    this.fig = fig; this.svg = svg; this.opts = opts;
    this.tracks = buildTracks(svg, opts);
    this.state = "rest"; this.raf = 0; this.io = null;
  }
  Controller.prototype.reset = function () {
    this.cancel();
    this.tracks.forEach(function (t) { t.hide(); });
    this.state = "armed";
  };
  Controller.prototype.cancel = function () { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; };
  Controller.prototype.finish = function () {
    this.cancel();
    this.tracks.forEach(function (t) { t.step(1); t.done(); });
    this.state = "rest";
    this.svg.removeAttribute("data-fa-state");
  };
  Controller.prototype.play = function () {
    var self = this;
    if (reduced()) { this.finish(); return; }
    if (this.state !== "armed") this.reset();
    this.state = "playing";
    this.svg.setAttribute("data-fa-state", "playing");
    var t0 = null, tracks = this.tracks;
    function frame(now) {
      if (t0 === null) t0 = now;
      if (reduced()) { self.finish(); return; }
      var el = now - t0, live = false;
      for (var i = 0; i < tracks.length; i++) {
        var t = tracks[i];
        if (t.over) continue;
        var p = (el - t.delay) / t.dur;
        if (p <= 0) { live = true; continue; }
        if (p >= 1) { t.step(1); t.done(); t.over = true; continue; }
        t.step(t.ease(p)); live = true;
      }
      if (live) self.raf = requestAnimationFrame(frame);
      else { tracks.forEach(function (t) { delete t.over; }); self.raf = 0; self.state = "rest"; self.svg.removeAttribute("data-fa-state"); }
    }
    this.raf = requestAnimationFrame(frame);
  };
  Controller.prototype.observe = function () {
    var self = this;
    if (!("IntersectionObserver" in window)) { this.finish(); return; }
    this.io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var rb = en.rootBounds, need = en.boundingClientRect.height * 0.35;
        if (rb && rb.height) need = Math.min(need, rb.height * 0.5);  // a figure taller than the screen still starts
        if (en.intersectionRatio >= 0.35 || en.intersectionRect.height >= need) {
          self.io.disconnect(); self.io = null;
          self.play();
        }
      });
    }, { threshold: [0, 0.1, 0.2, 0.35, 0.5] });
    this.io.observe(this.fig);
  };

  /* ------------------------------------------------------------------ public */
  function attach(fig, svgText, opts) {
    opts = opts || {};
    if (!fig || !svgText) return null;
    if (fig.__figanim) return fig.__figanim;
    var svg = parseSvg(svgText);
    if (!svg) return null;
    ensureFonts();
    if (!svg.querySelector("[data-fa]") && opts.mode) autoTag(svg, opts.mode);

    var link = fig.querySelector("a.zoom");
    var img = (link || fig).querySelector("img");
    var vb = viewBox(svg);
    var w = img ? +img.getAttribute("width") : 0, h = img ? +img.getAttribute("height") : 0;
    var ratio = w && h ? w + " / " + h : vb[2] + " / " + vb[3];

    svg.removeAttribute("width"); svg.removeAttribute("height");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("class", ((img && img.className ? img.className.replace(/\blazy\b/g, "") + " " : "") + "figanim-svg").replace(/\s+/g, " ").trim());
    svg.style.aspectRatio = ratio;
    svg.setAttribute("focusable", "false");
    svg.setAttribute("role", "img");
    var alt = img ? img.getAttribute("alt") || "" : (opts.label || "");
    if (alt) {
      var id = "figanim-t-" + (fig.id || "x") + "-" + (++uid);
      var title = document.createElementNS(SVGNS, "title");
      title.id = id; title.textContent = alt;
      svg.insertBefore(title, svg.firstChild);
      svg.setAttribute("aria-labelledby", id);
    }

    if (img) {
      img.parentNode.insertBefore(svg, img);
      img.hidden = true;                   // kept for the lightbox (alt) and as the zoom source
      img.style.display = "none";          // [hidden] loses to author rules such as `figure img {display:block}`
      img.setAttribute("aria-hidden", "true");
    } else (link || fig).insertBefore(svg, (link || fig).firstChild);
    fig.classList.add("has-figanim");
    // tracks are measured on the attached SVG and hidden in the same task, so nothing flashes at rest first
    var ctl = new Controller(fig, svg, opts);
    fig.__figanim = ctl;
    armed.push(ctl);
    if (reduced()) ctl.state = "rest";
    else { ctl.reset(); ctl.observe(); }
    return ctl;
  }

  function attachAll(root, getText, config) {
    root = root || document;
    config = config || window.FIGANIM_CONFIG || {};
    var ids = Object.keys(config);
    var pending = [];
    ids.forEach(function (id) {
      var fig = root.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(id) : id));
      if (fig && !fig.__figanim && !fig.__figanimPending) pending.push([fig, config[id]]);
    });
    function load(fig, cfg) {
      if (fig.__figanim || fig.__figanimPending) return;
      fig.__figanimPending = true;
      Promise.resolve(getText(cfg.svg)).then(function (text) {
        if (typeof text !== "string" && text && text.data) text = text.data;
        attach(fig, text, cfg);
      }).catch(function () { /* the book image stays */ }).then(function () { fig.__figanimPending = false; });
    }
    if (!("IntersectionObserver" in window)) { pending.forEach(function (p) { load(p[0], p[1]); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        var p = pending.filter(function (x) { return x[0] === en.target; })[0];
        if (p) load(p[0], p[1]);
      });
    }, { rootMargin: "800px 0px" });
    pending.forEach(function (p) { io.observe(p[0]); });
  }

  function finishAll() { armed.forEach(function (c) { if (c.io) { c.io.disconnect(); c.io = null; } c.finish(); }); }

  window.addEventListener("beforeprint", finishAll);

  var FigAnim = window.FigAnim = {
    attach: attach,
    attachAll: attachAll,
    finishAll: finishAll,
    fontBase: "fonts/",
    version: "1.0.0"
  };
})();
