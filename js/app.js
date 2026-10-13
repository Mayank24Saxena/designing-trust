/* Designing Trust — digital edition v2. One global navigation (top bar), one place for the current view's
   controls (the dock), one audio owner. No dependencies beyond the bundled three.js (3D book) and qrcode. */
(function () {
  "use strict";
  var doc = document, root = doc.documentElement, CFG = window.SITE_CONFIG || {};
  var $ = function (s, el) { return (el || doc).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(s)); };
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function announce(t) { var a = $("#announce"); a.textContent = ""; setTimeout(function () { a.textContent = t; }, 40); }
  function mq(q) { try { return matchMedia(q).matches; } catch (e) { return false; } }
  function reduced() { return root.dataset.motion === "reduce"; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fmt(s) { s = Math.max(0, Math.round(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x; }
  function fmtLong(s) { var m = Math.round(s / 60); return m >= 60 ? Math.floor(m / 60) + " h " + (m % 60) + " min" : m + " min"; }
  var PAGES = 212;
  var TITLE = "Designing Trust in Self-Administered Colorectal Cancer Screening";

  /* ================================================================ settings / Personalize */
  var SKEY = "gpbook2.settings";
  var DEF = { theme: "light", size: 19, font: "sans", spacing: "default", motion: null, measure: 66, setupDone: false };
  var S = Object.assign({}, DEF, store(SKEY) || {});
  var FONT_NAMES = { sans: "Sans", serif: "Serif", hyper: "Hyperlegible", dyslexic: "Dyslexia-friendly" };
  function apply() {
    root.dataset.theme = S.theme || "light";
    root.dataset.font = S.font;
    root.dataset.spacing = S.spacing;
    root.dataset.motion = (S.motion === "reduce" || (!S.motion && mq("(prefers-reduced-motion: reduce)"))) ? "reduce" : "on";
    root.style.setProperty("--fs", S.size + "px");
    root.style.setProperty("--measure", S.measure + "ch");
    var m = $('meta[name="theme-color"]'); if (m) m.content = getComputedStyle(root).getPropertyValue("--bg").trim() || "#ffffff";
    Book.onTheme(); Home.onTheme();
  }
  function save() { store(SKEY, S); }

  var pz = $("#pz"), pzForm = $("#pz-form");
  function rangeFill(el) { var p = (el.value - el.min) / (el.max - el.min) * 100; el.style.setProperty("--p", p + "%"); }
  function syncForm() {
    ["theme", "font", "spacing"].forEach(function (n) { $$('input[name="' + n + '"]', pzForm).forEach(function (r) { r.checked = r.value === (n === "theme" ? root.dataset.theme : S[n]); }); });
    var sz = pzForm.elements.size, ms = pzForm.elements.measure;
    sz.value = S.size; $("#out-size").textContent = S.size + " px"; sz.setAttribute("aria-valuetext", S.size + " pixels"); rangeFill(sz);
    ms.value = S.measure; $("#out-measure").textContent = S.measure + " characters"; ms.setAttribute("aria-valuetext", S.measure + " characters per line"); rangeFill(ms);
    $("#set-reduce").checked = root.dataset.motion === "reduce";
    $("#pz-preview-v").textContent = S.size + " px · " + FONT_NAMES[S.font] + " · " + ({ default: "Default", relaxed: "Relaxed", easy: "Easy-read" })[S.spacing];
  }
  pzForm.addEventListener("input", function (e) {
    var t = e.target;
    if (t.name === "size" || t.name === "measure") S[t.name] = Number(t.value);
    else if (t.name === "reduce") S.motion = t.checked ? "reduce" : "on";
    else if (t.name) S[t.name] = t.value;
    apply(); save(); syncForm(); if (Read.loaded) Read.onLayout();
  });
  pzForm.addEventListener("submit", function (e) { e.preventDefault(); });
  function step(d) { S.size = Math.max(15, Math.min(30, S.size + d)); apply(); save(); syncForm(); if (Read.loaded) Read.onLayout(); }
  $("#size-down").addEventListener("click", function () { step(-1); });
  $("#size-up").addEventListener("click", function () { step(1); });
  $("#pz-reset").addEventListener("click", function () { var done = S.setupDone; S = Object.assign({}, DEF, { setupDone: done }); apply(); save(); syncForm(); announce("Reset to defaults."); });

  /* ================================================================ dialogs: open, close with a short exit */
  function openDialog(d, opener) { d._opener = opener || doc.activeElement; if (!d.open) d.showModal(); }
  function closeDialog(d) {
    if (!d || !d.open || d._closing) return Promise.resolve();
    if (reduced() || !(d.classList.contains("sheet") || d.classList.contains("pz"))) { d.close(); return Promise.resolve(); }
    d._closing = true; d.classList.add("is-closing");
    return wait(d.classList.contains("pz") ? 400 : 200).then(function () { d.classList.remove("is-closing"); d._closing = false; d.close(); });
  }
  $$("dialog").forEach(function (d) {
    d.addEventListener("click", function (e) { if (e.target === d && !d.classList.contains("is-first")) { if (d === pz) closePz(); else closeDialog(d); } });
    d.addEventListener("cancel", function (e) { e.preventDefault(); if (d === pz) { if (d.classList.contains("is-first")) finishFirst(false); else closePz(); } else closeDialog(d); });
    d.addEventListener("close", function () { var o = d._opener; d._opener = null; if (o && o.focus && doc.contains(o) && o.offsetParent !== null) o.focus({ preventScroll: true }); });
  });
  doc.addEventListener("click", function (e) {
    var c = e.target.closest && e.target.closest("[data-close]"); if (!c) return;
    var d = c.closest("dialog"); if (!d) return;
    if (d === pz) { if (d.classList.contains("is-first")) finishFirst(false); else closePz(); } else closeDialog(d);
  });

  var pBtn = $("#t-personalize");
  function openPz() { pz.classList.remove("is-first"); $("#pz-done").textContent = "Done"; syncForm(); openDialog(pz, pBtn); }
  function closePz() {
    // shrink towards the Personalize button: the panel goes back where it came from
    if (!reduced()) { var b = pBtn.getBoundingClientRect(), p = pz.getBoundingClientRect(); pz.style.setProperty("--to", "translate(" + (b.left + b.width / 2 - (p.left + p.width / 2)) * .9 + "px," + (b.top - p.top - p.height / 2) * .9 + "px) scale(.12)"); }
    return closeDialog(pz).then(function () { pz.style.removeProperty("--to"); });
  }
  pBtn.addEventListener("click", openPz);
  $("#pz-done").addEventListener("click", function () { if (pz.classList.contains("is-first")) finishFirst(true); else closePz(); });
  $("#pz-skip").addEventListener("click", function () { finishFirst(false); });
  /* the first-run moment: the one place motion is allowed to be expressive */
  var firstResolve = null;
  function runFirst() {
    return new Promise(function (resolve) {
      firstResolve = resolve;
      pz.classList.add("is-first"); $("#pz-done").textContent = "Start reading";
      $("#pz-title").textContent = "Make it yours";
      syncForm(); openDialog(pz, null);
      setTimeout(function () { var f = $('input[name="theme"]:checked', pz) || $("input", pz); if (f) f.focus(); }, 80);
    });
  }
  function finishFirst(ok) {
    S.setupDone = true; save(); pz._opener = null;
    closePz().then(function () {
      pz.classList.remove("is-first"); $("#pz-title").textContent = "Personalize";
      announce(ok ? "Saved. Personalize is at the top right whenever you need it." : "Skipped. Personalize is at the top right whenever you need it.");
      var r = firstResolve; firstResolve = null; if (r) r();
    });
  }

  /* ================================================================ gate */
  async function gate() {
    var q = new URLSearchParams(location.search);
    if (CFG.gate === false || (CFG.allowBypassParam && q.has("nogate"))) { Vault.bypass(); return; }
    if (await Vault.restore()) return;
    var g = $("#gate"), f = $("#gate-form"), input = $("#gate-code"), msg = $("#gate-msg");
    g.hidden = false;
    if (mq("(pointer: fine)")) setTimeout(function () { input.focus({ preventScroll: true }); }, 30);
    await new Promise(function (resolve) {
      f.addEventListener("submit", async function (e) {
        e.preventDefault();
        var code = input.value;
        g.classList.remove("is-wrong");
        if (!code.trim()) { msg.textContent = "Enter the access code from the book."; return; }
        msg.textContent = "Opening…";
        var ok = false; try { ok = await Vault.unlock(code); } catch (err) { ok = false; }
        if (!ok) { g.classList.add("is-wrong"); msg.textContent = "That code didn’t open it. Check the spelling and try again."; input.select(); return; }
        msg.textContent = "";
        g.classList.add("is-leaving"); await wait(reduced() ? 0 : 320);
        g.hidden = true; g.classList.remove("is-leaving"); resolve();
      });
    });
  }

  /* ================================================================ manifests */
  var manifests = {};
  async function manifest(name) {
    if (manifests[name]) return manifests[name];
    try { manifests[name] = await getAsset(name + "/manifest.json", "json"); } catch (e) { manifests[name] = {}; }
    return manifests[name];
  }
  var pagemap = null;
  async function pageMap() { if (!pagemap) { try { pagemap = await getAsset("data/pagemap.json", "json"); } catch (e) { pagemap = {}; } } return pagemap; }

  /* ================================================================ router */
  var views = { home: $("#view-home"), read: $("#view-read"), listen: $("#view-listen"), watch: $("#view-watch") };
  var current = null;
  function parse(h) {
    h = decodeURIComponent((h || "").replace(/^#\/?/, ""));
    if (!h || h === "home") return { view: "home" };
    var m = h.match(/^(read|listen|watch)(?:\/(.+))?$/);
    if (m) return { view: m[1], target: m[2] || null };
    return { view: "read", target: h };
  }
  async function route(initial) {
    var r = parse(location.hash);
    var changed = current !== r.view;
    if (changed) {
      Object.keys(views).forEach(function (k) { views[k].hidden = k !== r.view; });
      if (!initial && !reduced()) { views[r.view].classList.remove("enter"); void views[r.view].offsetWidth; views[r.view].classList.add("enter"); }
      current = r.view;
      $$(".tab").forEach(function (t) { if (t.dataset.tab === r.view) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current"); });
      doc.body.dataset.view = r.view;
      if (r.view !== "read") { TTS.stop(); Focus.set(false); HL.hidePop(); Book.pause(); }
      Home.active(r.view === "home");
      Dock.update(); Player.updateMini();
      doc.title = ({ home: "", read: "Read · ", listen: "Listen · ", watch: "Watch · " }[r.view]) + "Designing Trust · Mayank Saxena";
      $("#progress").style.transform = "scaleX(0)";
    }
    if (r.view === "home") {
      Home.init(); window.scrollTo(0, 0); if (!initial && changed) $("#home-title").focus({ preventScroll: true });
    } else if (r.view === "read") {
      await Read.load();
      if (r.target === "book") { Read.setMode("book"); }
      else if (r.target && /^page-(\d+)$/.test(r.target)) { var pg = Number(r.target.slice(5)); if (Read.mode === "book" && Book.b) Book.goTo(pg); else { Book.pending = pg; Read.setMode("book"); } }
      else {
        if (r.target || !Read.mode) Read.setMode(Read.mode === "book" && !r.target ? "book" : "scroll");
        if (Read.mode === "scroll") await Read.go(r.target, initial || changed);
      }
      if (changed && !initial) $("#read-title").focus({ preventScroll: true });
    } else if (r.view === "listen") {
      await Player.init(); window.scrollTo(0, 0);
      if (r.target) Player.reveal(r.target);
      if (!initial && changed) $("#listen-title").focus({ preventScroll: true });
    } else {
      Watch.show(); window.scrollTo(0, 0); if (!initial && changed) $("#watch-title").focus({ preventScroll: true });
    }
    Dock.update();
  }
  window.addEventListener("hashchange", function () { route(false); });
  (function () {
    var lastY = 0, compact = false;
    window.addEventListener("scroll", function () {
      var y = scrollY; $("#top").classList.toggle("is-scrolled", y > 8);
      // slim the bar once the reader is under way; restore it near the top
      var want = y > 120 ? (y > lastY + 2 ? true : (y < lastY - 24 ? false : compact)) : false;
      if (want !== compact) { compact = want; root.classList.toggle("top-compact", compact); }
      lastY = y;
    }, { passive: true });
  })();

  /* ================================================================ dock: the current view's controls */
  var Dock = {
    el: $("#dock"),
    update: function () {
      var on = current === "read";
      if (on) { this.el.hidden = false; requestAnimationFrame(function () { Dock.el.classList.remove("is-away"); }); }
      else { this.el.classList.add("is-away"); var el = this.el; setTimeout(function () { if (current !== "read") el.hidden = true; }, reduced() ? 0 : 300); }
      var mode = Read.mode || "scroll";
      doc.body.classList.toggle("read-mode-book", on && mode === "book");
      $$("[data-only]", this.el).forEach(function (b) { b.hidden = b.dataset.only !== mode; });
      $("#m-scroll").setAttribute("aria-pressed", String(mode === "scroll"));
      $("#m-book").setAttribute("aria-pressed", String(mode === "book"));
      $("#more-menu").hidden = true; $("#t-more").setAttribute("aria-expanded", "false");
    },
    where: function (t) { $("#d-where").textContent = t; }
  };
  $("#m-scroll").addEventListener("click", function () { Read.setMode("scroll", true); });
  $("#m-book").addEventListener("click", function () { Read.setMode("book", true); });
  $("#d-contents").addEventListener("click", function () { Contents.open(); });
  // More menu (small screens): proxies to the hidden dock tools
  var more = $("#more-menu"), moreBtn = $("#t-more");
  moreBtn.addEventListener("click", function () {
    var open = more.hidden; more.hidden = !open; moreBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      var r = moreBtn.getBoundingClientRect(); more.style.left = Math.max(12, Math.min(innerWidth - 232, r.right - 220)) + "px"; more.style.bottom = (innerHeight - r.top + 10) + "px"; more.style.top = "auto";
      $$("[data-proxy]", more).forEach(function (b) { var t = $("#" + b.dataset.proxy); if (t.hasAttribute("aria-pressed")) b.setAttribute("aria-pressed", t.getAttribute("aria-pressed")); });
      $("button", more).focus();
    }
  });
  more.addEventListener("click", function (e) { var b = e.target.closest("[data-proxy]"); if (!b) return; more.hidden = true; moreBtn.setAttribute("aria-expanded", "false"); $("#" + b.dataset.proxy).click(); });
  more.addEventListener("keydown", function (e) {
    var bs = $$("button", more), i = bs.indexOf(doc.activeElement);
    if (e.key === "Escape") { more.hidden = true; moreBtn.setAttribute("aria-expanded", "false"); moreBtn.focus(); }
    if (e.key === "ArrowDown") { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); bs[(i + bs.length - 1) % bs.length].focus(); }
  });
  doc.addEventListener("mousedown", function (e) { if (!more.hidden && !more.contains(e.target) && e.target !== moreBtn && !moreBtn.contains(e.target)) { more.hidden = true; moreBtn.setAttribute("aria-expanded", "false"); } });

  /* ================================================================ share helpers */
  function baseUrl() { return (CFG.publicUrl || location.href.split("#")[0].split("?")[0]).replace(/index\.html$/, ""); }
  function linkFor(hash) { return baseUrl() + "#" + hash; }
  function qrSvg(text, label) {
    var q = qrcode(0, "M"); q.addData(text); q.make();
    var n = q.getModuleCount(), m = 2, d = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += "M" + (c + m) + " " + (r + m) + "h1v1h-1z";
    return '<svg viewBox="0 0 ' + (n + 2 * m) + " " + (n + 2 * m) + '" role="img" aria-label="' + esc(label) + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#0D0D0D"/></svg>';
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
    var ta = doc.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; doc.body.appendChild(ta); ta.select();
    var ok = false; try { ok = doc.execCommand("copy"); } catch (e) {} ta.remove(); return ok;
  }

  /* ================================================================ page textures for the 3D book */
  function pageTexture(i, size) { return getAsset("media/pages/" + (size === "s" ? "s/" : "") + "p" + ("00" + i).slice(-3) + ".webp", "url"); }
  function themeFor3D() { var cs = getComputedStyle(root); return { paper: "#ffffff", ink: cs.getPropertyValue("--ink").trim(), dark: root.dataset.theme === "dark" || root.dataset.theme === "contrast" }; }

  /* ================================================================ home */
  var Home = {
    done: false, book: null,
    init: async function () {
      if (this.done) return; this.done = true;
      $("#epub-size").textContent = CFG.epubBytes ? "(" + (CFG.epubBytes / 1e6).toFixed(1) + " MB)" : "";
      $("#epub-link").addEventListener("click", async function (e) {
        if (!CFG.encrypted) return;
        e.preventDefault();
        var url = await getAsset("media/Mayank-GP-Book.epub", "url"); var a = doc.createElement("a"); a.href = url; a.download = "Mayank-GP-Book.epub"; doc.body.appendChild(a); a.click(); a.remove();
      });
      var am = await manifest("audio"), vm = await manifest("video");
      if (am && am.tracks && am.tracks.length) $("#route-listen-len").textContent = am.tracks.length + " chapters · " + fmtLong(am.total_duration || am.tracks.reduce(function (s, t) { return s + (t.duration || 0); }, 0));
      var vOn = !!(vm && vm.youtube);
      $("#route-watch-soon").hidden = vOn; $("#route-watch").classList.toggle("is-soon", !vOn); $("#watch-soon-tab").hidden = vOn;
      this.mountBook();
    },
    mountBook: function () {
      var host = $("#home-book");
      if (!window.Book3D || !window.WebGLRenderingContext) { $("#home-stage").hidden = true; return; }
      try {
        this.book = Book3D.create(host, { count: PAGES, aspect: 420 / 297, getTexture: pageTexture, startPage: 0, reducedMotion: reduced(), theme: themeFor3D() });
        host.removeAttribute("tabindex"); host.setAttribute("aria-hidden", "true");
        // the closed book turns very slightly towards the pointer: alive, never busy
        var dbg = this.book._debug;
        if (dbg && dbg.setView && !reduced() && mq("(pointer: fine)")) {
          var raf = 0, tx = 0, ty = 0;
          views.home.addEventListener("pointermove", function (e) {
            tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5;
            if (!raf) raf = requestAnimationFrame(function () { raf = 0; try { dbg.setView(0.66 + ty * 0.10, 0.12 + tx * 0.22, 1); } catch (er) {} });
          });
        }
        // clicking the closed book opens Book mode
        host.addEventListener("click", function () { location.hash = "#read/book"; });
        host.style.cursor = "pointer";
      } catch (e) { $("#home-stage").hidden = true; }
    },
    active: function (on) { if (this.book && this.book.setPaused) this.book.setPaused(!on); },
    onTheme: function () { if (this.book) this.book.setTheme(themeFor3D()); }
  };

  /* ================================================================ watch */
  var Watch = {
    show: async function () {
      var v = await manifest("video"), wb = $("#watch-body");
      if (!v || !v.youtube) {
        wb.innerHTML = '<div class="soon-card"><div class="art-grain" aria-hidden="true"></div><p class="soon-rec"><i aria-hidden="true"></i>In the edit</p><p>The film is being cut. It will play here as soon as it is ready.</p><a class="btn" href="#read">Read the book meanwhile<svg class="ico arrow" aria-hidden="true"><use href="#i-arrow"/></svg></a></div>';
        return;
      }
      if (!wb.querySelector("iframe")) wb.innerHTML = '<div class="yt"><iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(v.youtube) + '?rel=0" title="' + esc(v.title || "Film") + '" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>';
    }
  };

  /* ================================================================ read: scroll mode */
  var book = $("#book");
  var Read = {
    loaded: false, loading: null, units: [], heads: [], paras: [], holdHash: 0, mode: null, cur: null, toc: [],
    load: function () {
      if (this.loading) return this.loading;
      var self = this;
      this.loading = Promise.all([getAsset("data/book.html", "text"), getAsset("data/toc.json", "json")]).then(function (res) {
        book.innerHTML = res[0]; book.setAttribute("aria-busy", "false"); self.toc = res[1];
        self.loaded = true; self.units = $$("section.unit", book); self.paras = $$("[data-pid]", book);
        self.sizeFigures(); Contents.build(); self.lazy(); self.reveal(); self.spy(); HL.restoreAll(); self.figures();
      }).catch(function (e) { book.innerHTML = '<p class="book-loading">The book could not be opened (' + esc(e.message) + ").</p>"; });
      return this.loading;
    },
    setMode: function (m, user) {
      if (m === this.mode) { Dock.update(); return; }
      var prev = this.mode; this.mode = m;
      if (m === "book") {
        TTS.stop(); Focus.set(false); HL.hidePop();
        var startPage = null;
        if (prev === "scroll" && this.cur) startPage = this.pageOf(this.cur);
        Book.show(startPage);
        if (location.hash !== "#read/book" && user) history.replaceState(null, "", "#read/book");
      } else {
        Book.pause();
        var back = prev === "book" ? Book.anchor() : null;
        Dock.update();
        if (back) this.go(back, true);
        if (user && location.hash === "#read/book") history.replaceState(null, "", "#read");
      }
      try { store("gpbook2.mode", m); } catch (e) {}
      Dock.update();
      if (user) announce(m === "book" ? "Book view. The printed pages, as an object." : "Scroll view.");
    },
    /* figures never taller than ~70% of the screen: tall and square images get a narrower frame, caption included */
    sizeFigures: function () {
      $$(".figure", book).forEach(function (f) {
        var imgs = $$("img", f); if (!imgs.length) return;
        var w = Number(imgs[0].getAttribute("width")), h = Number(imgs[0].getAttribute("height")); if (!w || !h) return;
        var cols = Number((f.getAttribute("style") || "").replace(/.*--cols:\s*(\d+).*/, "$1")) || 1;
        if (!f.classList.contains("figure--grid")) cols = 1;
        cols = Math.min(cols, imgs.length); var rows = Math.ceil(imgs.length / cols);
        var aspect = (w / h) * cols / rows;
        // figures open larger in the lightbox, so in the text they stay modest: plain panels (portraits, the QR) smallest
        var plain = f.classList.contains("figure--plain"), vh = plain ? 30 : 50;
        var cap = plain ? (/^qr-/.test(f.id) ? "13rem" : aspect <= 1.05 ? "10.5rem" : "20rem") : "calc(var(--measure) + 3rem)";
        if (aspect < 2.2 || plain) f.style.setProperty("--w", "min(100cqw, " + cap + ", " + (vh * aspect).toFixed(2) + "vh)");
        else f.style.setProperty("--w", "min(100cqw, calc(var(--measure) + 3rem))");
      });
    },
    pageOf: function (el) { var pm = pagemap || {}, unit = el.matches("section.unit") ? el : el.closest("section.unit"); return pm[el.id] || (unit && pm[unit.id]) || 1; },
    lazy: function () {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return; io.unobserve(e.target);
          var img = e.target;
          getAsset(img.getAttribute("data-src"), "url").then(function (u) { img.onload = function () { img.classList.add("is-loaded"); }; img.src = u; });
        });
      }, { rootMargin: "1400px 0px" });
      $$("img.lazy", book).forEach(function (i) { io.observe(i); });
    },
    /* text rises out of the fog: a one-time, quiet reveal for each block */
    reveal: function () {
      var blocks = $$(".unit > *, .unit .ch-head > *, .figure, .pullquote", book).filter(function (el) { return !el.matches(".ch-head, header.tp"); });
      blocks.forEach(function (b) { b.classList.add("rv"); });
      if (!window.IntersectionObserver) { blocks.forEach(function (b) { b.classList.add("in"); }); return; }
      var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { rootMargin: "0px 0px -8% 0px", threshold: 0.01 });
      blocks.forEach(function (b) { io.observe(b); });
      this.revealIO = io;
    },
    revealNear: function (el) {
      var r0 = el.getBoundingClientRect().top;
      $$(".rv:not(.in)", book).forEach(function (b) { var t = b.getBoundingClientRect().top; if (t > r0 - innerHeight && t < r0 + innerHeight * 1.5) b.classList.add("in"); });
    },
    figures: async function () {
      if (!window.FigAnim) return;
      try {
        var cfg = await getAsset("data/figanim.json", "json");
        FigAnim.attachAll(book, function (p) { return getAsset(p, "text"); }, cfg);
      } catch (e) { /* figures stay as images */ }
    },
    spy: function () {
      var self = this;
      this.heads = $$("section.unit, h2[id]", book);
      var ticking = false;
      function onScroll() {
        ticking = false;
        if (current !== "read" || self.mode !== "scroll") return;
        var y = 64 + innerHeight * 0.25, best = null;
        for (var i = 0; i < self.heads.length; i++) { var top = self.heads[i].getBoundingClientRect().top; if (top <= y) best = self.heads[i]; else break; }
        best = best || self.heads[0];
        if (best && best !== self.cur) { self.cur = best; self.markNav(best); }
        var max = root.scrollHeight - innerHeight, p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
        $("#progress").style.transform = "scaleX(" + p.toFixed(4) + ")";
        Focus.update();
      }
      window.addEventListener("scroll", function () { if (!ticking && current === "read") { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
      window.addEventListener("resize", function () { if (current === "read") onScroll(); });
      this.onLayout = onScroll;
      setTimeout(onScroll, 50);
    },
    labelFor: function (unit) { var n = unit.dataset.kind === "chapter" && unit.id.match(/ch-(\d+)/); return (n ? n[1] + " · " : "") + unit.dataset.title; },
    markNav: function (el) {
      var unit = el.matches("section.unit") ? el : el.closest("section.unit");
      Dock.where(this.labelFor(unit));
      Contents.mark(unit.id, el.id);
      if (current === "read" && history.replaceState && Date.now() > Read.holdHash) {
        var h = "#read/" + (el.id || unit.id);
        if (location.hash !== h) history.replaceState(null, "", h);
      }
    },
    go: async function (target, jump) {
      var el = null;
      if (target) {
        el = doc.getElementById(target);
        if (!el) {
          var l = target.toLowerCase().replace(/\./g, "-"), m;
          if ((m = l.match(/^(?:ch|chapter)-?(\d{1,2})(-\d+)?$/))) l = "ch-" + ("0" + m[1]).slice(-2) + (m[2] || "");
          else if ((m = l.match(/^(fig|figure|plate|table)-?(p?\d+)-(\d+)$/))) l = ({ figure: "fig" }[m[1]] || m[1]) + "-" + m[2] + "-" + m[3];
          el = doc.getElementById(l);
        }
        if (!el) { var map = { "fig-0-5": "img-p021-92", "fig-0-6": "fig-0-5", "fig-0-7": "fig-0-6", "fig-5-6": "fig-5-5", "fig-11-7": "fig-11-6" }; if (map[target]) el = doc.getElementById(map[target]); }
      }
      if (!el) { if (jump) window.scrollTo({ top: 0, behavior: "instant" }); return; }
      this.holdHash = Date.now() + 1500;
      this.revealNear(el);
      var scroller = function () { el.scrollIntoView({ block: "start", behavior: "instant" }); };
      scroller(); requestAnimationFrame(scroller); setTimeout(scroller, 120);
      var f = el.matches("section.unit") ? el.querySelector("h1") || el : el;
      if (!f.hasAttribute("tabindex")) f.setAttribute("tabindex", "-1");
      f.focus({ preventScroll: true });
      this.cur = null; setTimeout(this.onLayout, 60);
    }
  };

  /* lightbox */
  var lb = $("#lightbox"), lbImg = $("#lb-img"), lbStage = $("#lb-stage"), lbZoom = $("#lb-zoom");
  function zoomState(on) { lbStage.classList.toggle("is-zoomed", on); lbZoom.setAttribute("aria-pressed", String(on)); lbZoom.textContent = on ? "Fit to screen" : "Actual size"; }
  book.addEventListener("click", async function (e) {
    var a = e.target.closest("a.zoom"); if (!a) return;
    e.preventDefault();
    var img = a.querySelector("img"), cap = a.closest("figure") && a.closest("figure").querySelector("figcaption");
    lbImg.alt = img ? img.alt : ""; $("#lb-cap").innerHTML = cap ? cap.innerHTML : ""; $("#lb-cap").hidden = !cap;
    zoomState(false); openDialog(lb, a);
    lbImg.src = await getAsset(a.getAttribute("data-zoom"), "url");
  });
  lbImg.addEventListener("click", function () { zoomState(!lbStage.classList.contains("is-zoomed")); });
  lbZoom.addEventListener("click", function () { zoomState(!lbStage.classList.contains("is-zoomed")); });
  lbStage.addEventListener("click", function (e) { if (e.target === lbStage) closeDialog(lb); });

  /* ================================================================ contents (one list, for both modes) */
  var Contents = {
    built: false,
    build: function () {
      var html = "", lastGroup = null, units = Read.units;
      units.forEach(function (u) {
        var kind = u.dataset.kind, group = kind === "front" ? "Front matter" : kind === "end" ? "End matter" : null;
        if (kind === "part" || kind === "chapter" || u.id === "standing-decisions") {
          var part = u.dataset.kind === "part" ? u : null;
          if (part) { group = "Part " + (u.id.split("-")[1]) + " · " + u.dataset.title; }
          else group = lastGroup;
        }
        if (group && group !== lastGroup) { html += '<li class="toc-group" aria-hidden="true">' + esc(group) + "</li>"; lastGroup = group; }
        if (kind === "part") return;
        var n = kind === "chapter" ? (u.id.match(/ch-(\d+)/) || [])[1] : "";
        var subs = $$("h2[id]", u);
        html += '<li data-unit="' + u.id + '"><a href="#read/' + u.id + '"><span class="n">' + esc(n || "") + "</span><span>" + esc(u.dataset.title) + '</span><span class="pg" data-pg="' + u.id + '"></span></a>' +
          (subs.length ? '<ol class="toc-sub" hidden>' + subs.map(function (h) { return '<li><a href="#read/' + h.id + '"><span>' + esc(h.textContent) + "</span></a></li>"; }).join("") + "</ol>" : "") + "</li>";
      });
      $("#toc").innerHTML = html;
      pageMap().then(function (pm) { $$("[data-pg]").forEach(function (s) { var p = pm[s.dataset.pg]; if (p) s.textContent = "p. " + p; }); });
      $("#toc").addEventListener("click", function (e) {
        var a = e.target.closest("a"); if (!a) return;
        $("#contents")._opener = null; closeDialog($("#contents"));
        if (Read.mode === "book") {
          e.preventDefault(); var id = a.getAttribute("href").replace("#read/", "");
          pageMap().then(function (pm) { Book.goTo(pm[id] || 1); });
        }
      });
      this.built = true;
    },
    open: function () {
      openDialog($("#contents"), $("#d-contents"));
      var a = $("#toc [aria-current]"); if (a) a.scrollIntoView({ block: "center" });
    },
    mark: function (uid, id) {
      var list = $("#toc"); if (!list) return;
      $$("[aria-current]", list).forEach(function (a) { a.removeAttribute("aria-current"); });
      $$(".toc-sub", list).forEach(function (s) { s.hidden = true; });
      var row = $('[data-unit="' + uid + '"]', list); if (!row) return;
      var a = $("a", row); a.setAttribute("aria-current", "location");
      var sub = $(".toc-sub", row); if (sub) { sub.hidden = false; if (id && id !== uid) { var s = $('a[href="#read/' + id + '"]', sub); if (s) s.setAttribute("aria-current", "true"); } }
    }
  };

  /* ================================================================ read: book mode (3D) */
  var Book = {
    b: null, page: 0, hintT: 0,
    show: function (startPage) {
      var host = $("#book3d");
      Dock.update();
      if (!this.b) {
        if (!window.Book3D || !window.WebGLRenderingContext) { $("#stage").innerHTML = '<div class="stage-fallback"><p>This browser can’t show the 3D book. The scroll view has everything.</p></div>'; return; }
        try {
          var saved = store("gpbook2.page"); if (this.pending != null) { startPage = this.pending; this.pending = null; }
          this.b = Book3D.create(host, { count: PAGES, aspect: 420 / 297, getTexture: pageTexture, startPage: startPage != null ? startPage : (saved != null ? saved : 0), reducedMotion: reduced(), theme: themeFor3D(), onChange: function (st) { Book.onChange(st); } });
          this.onChange(this.b.state());
        } catch (e) { $("#stage").innerHTML = '<div class="stage-fallback"><p>The 3D book could not start on this device (' + esc(e.message) + '). The scroll view has everything.</p></div>'; return; }
      } else {
        if (this.b.setPaused) this.b.setPaused(false);
        if (this.pending != null) { startPage = this.pending; this.pending = null; }
        if (startPage != null) this.b.goTo(startPage);
      }
      window.scrollTo(0, 0);
      clearTimeout(this.hintT); $("#stage-hint").classList.remove("is-gone");
      this.hintT = setTimeout(function () { $("#stage-hint").classList.add("is-gone"); }, 9000);
      if (!this.hintBound) { this.hintBound = true; host.addEventListener("pointerdown", function () { clearTimeout(Book.hintT); Book.hintT = setTimeout(function () { $("#stage-hint").classList.add("is-gone"); }, 1600); }); }
    },
    pause: function () { if (this.b && this.b.setPaused) this.b.setPaused(true); },
    goTo: function (p) { if (this.b) this.b.goTo(p); else this.show(p); },
    onChange: function (st) {
      this.page = st.page || 0; store("gpbook2.page", this.page);
      var label = st.closed ? "Cover" : (st.spread && st.spread[0] && st.spread[1] ? st.spread[0] + "–" + st.spread[1] : String(st.page));
      $("#b-page").innerHTML = esc(label) + "<small>of " + PAGES + "</small>";
      $("#stage-status").textContent = st.closed ? "The closed book. Press the right arrow to open it." : "Pages " + label + " of " + PAGES + (st.zoomed ? ", close up" : "") + ".";
      $("#b-zoom").setAttribute("aria-pressed", String(!!st.zoomed));
      $("#b-prev").disabled = !!st.closed; $("#b-next").disabled = st.page >= PAGES;
      var pm = pagemap || {}, best = null, bp = -1;
      Object.keys(pm).forEach(function (k) { if (!/\./.test(k) && pm[k] <= Math.max(1, st.page) && pm[k] > bp && doc.getElementById(k) && doc.getElementById(k).matches("section.unit")) { bp = pm[k]; best = k; } });
      if (best) { var u = doc.getElementById(best); Dock.where(Read.labelFor(u)); Contents.mark(best, best); }
      else Dock.where(st.closed ? "Cover" : "Front matter");
      if (current === "read" && Read.mode === "book") $("#progress").style.transform = "scaleX(" + (Math.max(0, st.page) / PAGES).toFixed(4) + ")";
    },
    anchor: function () {
      var pm = pagemap || {}, best = null, bp = -1, p = Math.max(1, this.page);
      Object.keys(pm).forEach(function (k) { if (!/\./.test(k) && pm[k] <= p && pm[k] >= bp && doc.getElementById(k)) { if (pm[k] > bp || (best && doc.getElementById(best).matches("section.unit"))) { bp = pm[k]; best = k; } } });
      return best;
    },
    onTheme: function () { if (this.b) this.b.setTheme(themeFor3D()); if (this.b && this.b.setReducedMotion) this.b.setReducedMotion(reduced()); }
  };
  $("#b-prev").addEventListener("click", function () { if (Book.b) Book.b.prev(); });
  $("#b-next").addEventListener("click", function () { if (Book.b) Book.b.next(); });
  $("#b-reset").addEventListener("click", function () { if (Book.b) Book.b.resetView(); });
  $("#b-zoom").addEventListener("click", function () {
    if (!Book.b) return; var st = Book.b.state();
    if (st.zoomed) Book.b.zoomTo(null); else { if (st.closed) Book.b.next(); Book.b.zoomTo(st.spread && st.spread[1] ? "R" : "L"); }
  });

  /* ================================================================ share a section */
  var Share = {
    open: function () {
      var el = Read.cur || Read.units[0]; if (!el) return;
      var unit = el.matches("section.unit") ? el : el.closest("section.unit");
      var where = Read.labelFor(unit) + (el !== unit ? " · " + el.textContent : "");
      this.url = linkFor("read/" + el.id); this.name = where;
      $("#share-where").textContent = where; $("#share-url").textContent = this.url;
      $("#share-qr-box").hidden = true; $("#share-qr-box").innerHTML = ""; $("#share-qr").setAttribute("aria-expanded", "false"); $("#share-qr").textContent = "Show QR code";
      $("#share-native").hidden = !navigator.share;
      openDialog($("#sharebox"), $("#t-share").offsetParent ? $("#t-share") : $("#t-more"));
    }
  };
  $("#t-share").addEventListener("click", function () { Share.open(); });
  $("#share-copy").addEventListener("click", async function () { var b = this, ok = await copyText(Share.url); b.textContent = ok ? "Copied" : "Copy failed"; announce(ok ? "Link copied." : "Could not copy the link."); setTimeout(function () { b.textContent = "Copy link"; }, 2000); });
  $("#share-native").addEventListener("click", function () { navigator.share({ title: Share.name, url: Share.url }).catch(function () {}); });
  $("#share-qr").addEventListener("click", function () {
    var box = $("#share-qr-box"), open = box.hidden;
    if (open && !box.innerHTML) box.innerHTML = qrSvg(Share.url, "QR code for " + Share.name);
    box.hidden = !open; this.setAttribute("aria-expanded", String(open)); this.textContent = open ? "Hide QR code" : "Show QR code";
  });

  /* ================================================================ search */
  var Search = {
    idx: null,
    norm: function (s) { s = String(s || "").toLowerCase(); if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); return s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-"); },
    load: async function () { if (this.idx) return; var raw = await getAsset("data/search.json", "json"); var n = this.norm; this.idx = raw.map(function (r) { return { r: r, n: n(r.t), h: n(r.h) }; }); },
    run: function (q) {
      var n = this.norm, phrase = n(q).trim(), terms = phrase.split(/\s+/).filter(Boolean); if (!terms.length) return [];
      function count(h, t) { var c = 0, i = 0; while ((i = h.indexOf(t, i)) !== -1) { c++; i += t.length; } return c; }
      var res = [];
      this.idx.forEach(function (e) {
        var s = 0; for (var k = 0; k < terms.length; k++) { var c = count(e.n, terms[k]) + 4 * count(e.h, terms[k]); if (!c) return; s += c; }
        if (terms.length > 1 && e.n.indexOf(phrase) >= 0) s += 10; res.push({ e: e, s: s });
      });
      res.sort(function (a, b) { return b.s - a.s; });
      return res.slice(0, 60).map(function (x) {
        var t = x.e.r.t, i = x.e.n.indexOf(terms[0]); if (i < 0) i = 0;
        var a = Math.max(0, i - 70), b = Math.min(t.length, i + 150), s = (a ? "…" : "") + t.slice(a, b) + (b < t.length ? "…" : ""), ns = n(s), out = "", pos = 0, marks = [];
        terms.forEach(function (tm) { var j = 0; while ((j = ns.indexOf(tm, j)) !== -1) { marks.push([j, j + tm.length]); j += tm.length; } });
        marks.sort(function (p, q) { return p[0] - q[0]; });
        marks.forEach(function (m) { if (m[0] < pos) return; out += esc(s.slice(pos, m[0])) + "<mark>" + esc(s.slice(m[0], m[1])) + "</mark>"; pos = m[1]; });
        return { r: x.e.r, html: out + esc(s.slice(pos)) };
      });
    }
  };
  var qIn = $("#q"), results = $("#results"), sStatus = $("#search-status"), sTimer;
  async function openSearch() { openDialog($("#search"), $("#t-search")); setTimeout(function () { qIn.focus(); qIn.select(); }, 40); await Search.load(); }
  $("#t-search").addEventListener("click", openSearch);
  qIn.addEventListener("input", function () {
    clearTimeout(sTimer);
    sTimer = setTimeout(async function () {
      await Search.load(); var v = qIn.value;
      if (!v.trim()) { results.innerHTML = ""; sStatus.textContent = "Type a word or a phrase."; return; }
      var r = Search.run(v);
      sStatus.textContent = r.length ? (r.length === 60 ? "Showing the first 60 results" : r.length + (r.length === 1 ? " result" : " results")) : "No results";
      results.innerHTML = r.map(function (x) { return '<li><a href="#read/' + esc(x.r.i) + '"><span class="r-where">' + esc(x.r.c) + '</span><span class="r-title">' + esc(x.r.h) + '</span><span class="r-snip">' + x.html + "</span></a></li>"; }).join("");
    }, 120);
  });
  qIn.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); var a = $("a", results); if (a) a.click(); }
    if (e.key === "ArrowDown") { var f = $("a", results); if (f) { e.preventDefault(); f.focus(); } }
  });
  results.addEventListener("keydown", function (e) {
    var a = e.target.closest("a"); if (!a) return; var li = a.parentNode;
    if (e.key === "ArrowDown" && li.nextElementSibling) { e.preventDefault(); $("a", li.nextElementSibling).focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); if (li.previousElementSibling) $("a", li.previousElementSibling).focus(); else qIn.focus(); }
  });
  results.addEventListener("click", function (e) { if (e.target.closest("a")) { $("#search")._opener = null; closeDialog($("#search")); } });
  $("#search-form").addEventListener("submit", function (e) { e.preventDefault(); });
  doc.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (/input|textarea|select/.test(tag) || e.target.isContentEditable || doc.querySelector("dialog[open]")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (current === "read" && Read.mode === "scroll") {
      if (e.key === "/") { e.preventDefault(); openSearch(); }
      if ((e.key === "h" || e.key === "H") && HL.range) { e.preventDefault(); HL.showPop(true); }
    }
    if (current === "listen" && e.key === " " && !/button|a/.test(tag)) { e.preventDefault(); Player.toggle(); }
    if (current === "read" && Read.mode === "book" && Book.b && e.target === doc.body) {
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); Book.b.next(); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); Book.b.prev(); }
      if (e.key === "Escape") Book.b.zoomTo(null);
    }
  });

  /* ================================================================ one audio owner: the audiobook and read-aloud never overlap */
  var AudioOwner = {
    who: null,
    claim: function (who) {
      if (this.who && this.who !== who) { if (this.who === "book") Player.pause(); else if (this.who === "tts") TTS.stop(); }
      this.who = who;
    },
    release: function (who) { if (this.who === who) this.who = null; }
  };

  /* ================================================================ read aloud (Web Speech API) */
  var synth = window.speechSynthesis;
  var TTS = {
    on: false, paused: false, pi: -1, si: 0, sents: [], voice: null, rate: 1, token: 0,
    readable: function () { return Read.paras.filter(function (p) { return !p.closest(".fig-missing") && p.offsetParent !== null; }); },
    startIndex: function () {
      var list = this.readable(), top = 72;
      if (Focus.on && Focus.cur) { var k = list.indexOf(Focus.cur); if (k >= 0) return k; }
      for (var i = 0; i < list.length; i++) { var r = list[i].getBoundingClientRect(); if (r.bottom > top + 4) return i; }
      return 0;
    },
    split: function (text) {
      var out = [];
      if (window.Intl && Intl.Segmenter) { var seg = new Intl.Segmenter("en", { granularity: "sentence" }); for (var s of seg.segment(text)) { if (s.segment.trim()) out.push([s.index, s.index + s.segment.length]); } }
      else { var re = /[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g, m; while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]); }
      return out;
    },
    rangeFor: function (el, a, b) {
      var w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT), n, pos = 0, r = doc.createRange(), started = false;
      while ((n = w.nextNode())) {
        var len = n.nodeValue.length;
        if (!started && a <= pos + len) { r.setStart(n, Math.max(0, a - pos)); started = true; }
        if (started && b <= pos + len) { r.setEnd(n, Math.max(0, b - pos)); return r; }
        pos += len;
      }
      if (started) { r.setEndAfter(el.lastChild || el); return r; }
      return null;
    },
    voices: function () {
      var vs = synth ? synth.getVoices() : [], sel = $("#tts-voice");
      var en = vs.filter(function (v) { return /^en/i.test(v.lang); }); if (!en.length) en = vs;
      sel.innerHTML = en.length ? en.map(function (v, i) { return '<option value="' + i + '">' + esc(v.name.replace(/^(Microsoft|Google)\s+/, "").replace(/ Online \(Natural\).*$/, "")) + "</option>"; }).join("") : '<option value="">Device voice</option>';
      this._list = en;
      var pref = store("gpbook2.voice"); var k = en.findIndex(function (v) { return v.name === pref; });
      if (k < 0) k = Math.max(0, en.findIndex(function (v) { return /en-(GB|IN)/i.test(v.lang); }));
      if (en.length) { sel.value = String(k); this.voice = en[k]; }
    },
    setUI: function () {
      $("#tts").classList.toggle("is-playing", this.on && !this.paused);
      $("#tts-play span").textContent = this.paused ? "Play" : "Pause";
      $("#t-aloud").setAttribute("aria-pressed", String(this.on));
    },
    start: function () {
      if (!synth) { announce("Read aloud isn’t available in this browser."); return; }
      AudioOwner.claim("tts");
      this.on = true; this.paused = false; $("#tts").hidden = false;
      if (!this._list) this.voices();
      var r = store("gpbook2.rate"); if (r) { this.rate = r; $("#tts-rate").value = String(r); }
      this.list = this.readable(); this.pi = this.startIndex(); this.si = 0; this.prepare(); this.speak(); this.setUI();
      announce("Reading aloud from: " + (this.list[this.pi] ? this.list[this.pi].textContent.slice(0, 80) : ""));
    },
    prepare: function () { var el = this.list[this.pi]; this.text = el ? el.textContent : ""; this.sents = this.split(this.text); },
    mark: function () {
      var el = this.list[this.pi]; $$(".is-reading", book).forEach(function (x) { x.classList.remove("is-reading"); }); if (!el) return;
      el.classList.add("is-reading");
      var s = this.sents[this.si] || [0, this.text.length], range = this.rangeFor(el, s[0], s[1]);
      if (window.CSS && CSS.highlights && range) CSS.highlights.set("tts", new Highlight(range));
      var rect = range ? range.getBoundingClientRect() : el.getBoundingClientRect();
      if (rect.top < 90 || rect.bottom > innerHeight - 200) window.scrollTo({ top: scrollY + rect.top - innerHeight * 0.35, behavior: reduced() ? "auto" : "smooth" });
      var unit = el.closest("section.unit"); if (unit) $("#tts-status").textContent = Read.labelFor(unit);
    },
    speak: function () {
      var self = this, tok = ++this.token;
      if (!this.on) return;
      if (this.pi >= this.list.length) { this.stop(); announce("Finished reading."); return; }
      if (this.si >= this.sents.length) { this.pi++; this.si = 0; this.prepare(); return this.speak(); }
      this.mark();
      var s = this.sents[this.si], u = new SpeechSynthesisUtterance(this.text.slice(s[0], s[1]));
      if (this.voice) u.voice = this.voice; u.rate = this.rate; u.lang = (this.voice && this.voice.lang) || "en-GB";
      u.onend = function () { if (tok !== self.token || self.paused || !self.on) return; self.si++; self.speak(); };
      u.onerror = function (ev) { if (tok !== self.token) return; if (ev.error !== "interrupted" && ev.error !== "canceled") $("#tts-status").textContent = "This device couldn’t speak the text"; };
      synth.cancel(); synth.speak(u);
    },
    pause: function () { this.paused = true; this.token++; synth.cancel(); this.setUI(); },
    resume: function () { AudioOwner.claim("tts"); this.paused = false; this.setUI(); this.speak(); },
    step: function (d) { this.pi = Math.max(0, Math.min(this.list.length - 1, this.pi + d)); this.si = 0; this.prepare(); if (this.paused) this.mark(); else this.speak(); },
    stop: function () {
      if (!this.on) return; this.on = false; this.token++; if (synth) synth.cancel();
      $("#tts").hidden = true; this.setUI(); AudioOwner.release("tts");
      if (window.CSS && CSS.highlights) CSS.highlights.delete("tts");
      $$(".is-reading", book).forEach(function (x) { x.classList.remove("is-reading"); });
    }
  };
  if (synth) { if (synth.addEventListener) synth.addEventListener("voiceschanged", function () { TTS.voices(); }); else synth.onvoiceschanged = function () { TTS.voices(); }; }
  $("#t-aloud").addEventListener("click", function () { if (TTS.on) TTS.stop(); else TTS.start(); });
  $("#tts-play").addEventListener("click", function () { if (TTS.paused) TTS.resume(); else TTS.pause(); });
  $("#tts-prev").addEventListener("click", function () { TTS.step(-1); });
  $("#tts-next").addEventListener("click", function () { TTS.step(1); });
  $("#tts-stop").addEventListener("click", function () { TTS.stop(); $("#t-aloud").focus(); });
  $("#tts-rate").addEventListener("change", function () { TTS.rate = Number(this.value); store("gpbook2.rate", TTS.rate); if (TTS.on && !TTS.paused) TTS.speak(); });
  $("#tts-voice").addEventListener("change", function () { TTS.voice = TTS._list && TTS._list[Number(this.value)]; if (TTS.voice) store("gpbook2.voice", TTS.voice.name); if (TTS.on && !TTS.paused) TTS.speak(); });
  window.addEventListener("pagehide", function () { TTS.stop(); });

  /* ================================================================ the audiobook player */
  var au = $("#audio");
  var Player = {
    ready: false, tracks: [], i: -1, url: null, loadingI: -1, sleep: 0, sleepT: 0, pos: store("gpbook2.listen") || { i: 0, t: {} , done: {} },
    init: async function () {
      if (this.ready) return; this.ready = true;
      var m = await manifest("audio");
      this.tracks = (m && m.tracks) || [];
      if (!this.tracks.length) { $("#player").innerHTML = '<div class="empty">The audiobook isn’t available in this edition yet.</div>'; return; }
      var total = this.tracks.reduce(function (s, t) { return s + (t.duration || 0); }, 0);
      $("#book-len").textContent = this.tracks.length + " · " + fmtLong(total);
      var self = this;
      $("#tracks").innerHTML = this.tracks.map(function (t, i) {
        var g = t.title.match(/^(Chapter \d+|Part \d+):\s*(.+)$/), title = g ? g[2] : t.title, grp = g ? g[1] : "";
        return '<li><button type="button" class="track" data-i="' + i + '"><span class="track-n"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="n-txt">' + ("0" + (i + 1)).slice(-2) + '</span></span><span class="track-t">' + esc(title) + (grp ? '<span class="track-g">' + esc(grp) + "</span>" : "") + '</span><span class="track-d">' + fmt(t.duration) + '</span><span class="track-p" aria-hidden="true"><i></i></span></button></li>';
      }).join("");
      $("#tracks").addEventListener("click", function (e) { var b = e.target.closest(".track"); if (b) self.play(Number(b.dataset.i), true); });
      this.paintList();
      this.setTrack(this.pos.i || 0, false);
      var sp = store("gpbook2.speed"); if (sp) { $$('#speed input').forEach(function (r) { r.checked = Number(r.value) === sp; }); }
    },
    reveal: function (id) { var k = this.tracks.findIndex(function (t) { return t.id === id; }); if (k >= 0) { var b = $('.track[data-i="' + k + '"]'); if (b) b.scrollIntoView({ block: "center" }); } },
    paintList: function () {
      var self = this;
      $$(".track").forEach(function (b) {
        var i = Number(b.dataset.i), t = self.tracks[i], at = (self.pos.t || {})[i] || 0, done = (self.pos.done || {})[i];
        var pw = done ? 100 : Math.min(100, at / (t.duration || 1) * 100);
        $(".track-p i", b).style.width = pw + "%"; $(".track-p", b).classList.toggle("has-p", pw > 0.5);
        b.classList.toggle("is-done", !!done);
        if (i === self.i) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
      });
    },
    setTrack: function (i, show) {
      this.i = i; var t = this.tracks[i]; if (!t) return;
      $("#now-k").textContent = ("0" + (i + 1)).slice(-2) + " of " + this.tracks.length;
      $("#now-title").textContent = t.title;
      $("#mini-t").textContent = t.title;
      this.paintTime((this.pos.t || {})[i] || 0, t.duration);
      this.paintList();
    },
    load: async function (i) {
      var t = this.tracks[i]; if (!t) return false;
      if (this.loadedI === i && au.src) return true;
      this.loadingI = i; $("#now-k").textContent = "Opening " + ("0" + (i + 1)).slice(-2) + "…";
      var url;
      try { url = await getAsset(t.src, "url"); } catch (e) { announce("This chapter could not be opened."); this.setTrack(i); return false; }
      if (this.loadingI !== i) { if (CFG.encrypted) URL.revokeObjectURL(url); return false; }
      if (this.url && CFG.encrypted) URL.revokeObjectURL(this.url);
      this.url = url; au.src = url; this.loadedI = i;
      var start = (this.pos.t || {})[i] || 0; if ((this.pos.done || {})[i]) start = 0;
      await new Promise(function (r) { if (au.readyState >= 1) r(); else au.addEventListener("loadedmetadata", r, { once: true }); });
      if (start > 2 && start < (au.duration || 1e9) - 3) au.currentTime = start;
      au.playbackRate = this.speed();
      this.setTrack(i);
      return true;
    },
    speed: function () { var r = $('#speed input:checked'); return r ? Number(r.value) : 1; },
    play: async function (i, user) {
      if (i == null) i = this.i < 0 ? 0 : this.i;
      AudioOwner.claim("book");
      this.setTrack(i); this.pos.i = i; this.save();
      if (!(await this.load(i))) return;
      try { await au.play(); } catch (e) { announce("Press play to listen."); }
      this.media();
    },
    pause: function () { au.pause(); },
    toggle: function () { if (au.src && !au.paused) this.pause(); else this.play(this.i); },
    seekBy: function (d) { if (!au.src) return; au.currentTime = Math.max(0, Math.min((au.duration || 0) - .2, au.currentTime + d)); },
    next: function () { if (this.i < this.tracks.length - 1) this.play(this.i + 1); },
    prev: function () { if (au.src && au.currentTime > 5) { au.currentTime = 0; return; } if (this.i > 0) this.play(this.i - 1); },
    save: function () { store("gpbook2.listen", this.pos); },
    paintTime: function (cur, dur) {
      dur = dur || (this.tracks[this.i] || {}).duration || 0; var p = dur ? Math.min(1, cur / dur) : 0;
      $("#scrub-fill").style.width = p * 100 + "%"; $("#scrub-knob").style.left = p * 100 + "%";
      $("#t-cur").textContent = fmt(cur); $("#t-left").textContent = "−" + fmt(dur - cur);
      var s = $("#scrub"); s.setAttribute("aria-valuenow", String(Math.round(p * 100))); s.setAttribute("aria-valuetext", fmt(cur) + " of " + fmt(dur));
      $("#mini-s").textContent = fmt(cur) + " / " + fmt(dur); $("#mini-prog").style.width = p * 100 + "%";
    },
    playingUI: function () {
      var on = !!au.src && !au.paused;
      doc.body.classList.toggle("is-playing", on);
      $$(".pt-label").forEach(function (l) { l.textContent = on ? "Pause" : "Play"; });
      $("#p-toggle").setAttribute("aria-label", on ? "Pause" : "Play");
      this.updateMini();
    },
    updateMini: function () { $("#mini").hidden = !(au.src && current !== "listen" && this.i >= 0 && this.active); },
    media: function () {
      if (!("mediaSession" in navigator)) return;
      var t = this.tracks[this.i]; if (!t) return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: "Mayank Saxena", album: TITLE, artwork: [{ src: "favicon.svg", sizes: "any", type: "image/svg+xml" }] });
        var self = this;
        [["play", function () { self.play(self.i); }], ["pause", function () { self.pause(); }], ["previoustrack", function () { self.prev(); }], ["nexttrack", function () { self.next(); }],
          ["seekbackward", function () { self.seekBy(-15); }], ["seekforward", function () { self.seekBy(30); }], ["seekto", function (d) { if (d.seekTime != null) au.currentTime = d.seekTime; }]]
          .forEach(function (h) { try { navigator.mediaSession.setActionHandler(h[0], h[1]); } catch (e) {} });
      } catch (e) {}
    }
  };
  au.addEventListener("play", function () { Player.active = true; AudioOwner.claim("book"); Player.playingUI(); });
  au.addEventListener("pause", function () { Player.playingUI(); });
  au.addEventListener("timeupdate", function () {
    var i = Player.i; Player.paintTime(au.currentTime, au.duration);
    Player.pos.t = Player.pos.t || {}; Player.pos.t[i] = au.currentTime;
    if (!Player._sv || Date.now() - Player._sv > 3000) { Player._sv = Date.now(); Player.save(); var b = $('.track[data-i="' + i + '"] .track-p i'); if (b) b.style.width = Math.min(100, au.currentTime / (au.duration || 1) * 100) + "%"; }
    if ("mediaSession" in navigator && navigator.mediaSession.setPositionState && au.duration) { try { navigator.mediaSession.setPositionState({ duration: au.duration, playbackRate: au.playbackRate, position: au.currentTime }); } catch (e) {} }
  });
  au.addEventListener("progress", function () { try { if (au.buffered.length && au.duration) $("#scrub-buf").style.width = au.buffered.end(au.buffered.length - 1) / au.duration * 100 + "%"; } catch (e) {} });
  au.addEventListener("ended", function () {
    Player.pos.done = Player.pos.done || {}; Player.pos.done[Player.i] = 1; Player.pos.t[Player.i] = 0; Player.save(); Player.paintList();
    if (Player.sleep === "end") { Player.setSleep(0); announce("Sleep timer: stopped at the end of the chapter."); return; }
    Player.next();
  });
  // transport buttons (player + mini player share the same actions)
  doc.addEventListener("click", function (e) {
    var b = e.target.closest("[data-a]"); if (!b || !b.closest("#player, #mini")) return;
    var a = b.dataset.a;
    if (a === "toggle") Player.toggle(); else if (a === "back") Player.seekBy(-15); else if (a === "fwd") Player.seekBy(30);
    else if (a === "next") Player.next(); else if (a === "prev") Player.prev();
    else if (a === "close") { Player.pause(); Player.active = false; Player.updateMini(); AudioOwner.release("book"); }
  });
  $("#speed").addEventListener("change", function () { au.playbackRate = Player.speed(); store("gpbook2.speed", Player.speed()); announce("Speed " + Player.speed() + "×"); });
  Player.setSleep = function (v) {
    clearTimeout(this.sleepT); this.sleep = v; $("#sleep-status").textContent = "";
    $$('#sleep input').forEach(function (r) { r.checked = String(r.value) === String(v); });
    if (v && v !== "end") { var until = Date.now() + v * 60000; this.sleepT = setTimeout(function () { au.pause(); Player.setSleep(0); announce("Sleep timer: paused."); }, v * 60000); $("#sleep-status").textContent = "Pauses at " + new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
    if (v === "end") $("#sleep-status").textContent = "Pauses when this chapter ends";
  };
  $("#sleep").addEventListener("change", function () { var r = $('#sleep input:checked'); Player.setSleep(r.value === "end" ? "end" : Number(r.value)); });
  // scrubbing
  (function () {
    var bar = $("#scrub"), drag = false;
    function at(e) { var r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); }
    function seek(p) { var dur = au.duration || (Player.tracks[Player.i] || {}).duration || 0; if (au.src) au.currentTime = p * dur; else { Player.pos.t[Player.i] = p * dur; Player.paintTime(p * dur, dur); } }
    bar.addEventListener("pointerdown", function (e) { drag = true; bar.setPointerCapture(e.pointerId); bar.classList.add("is-drag"); seek(at(e)); });
    bar.addEventListener("pointermove", function (e) { if (drag) seek(at(e)); });
    bar.addEventListener("pointerup", function () { drag = false; bar.classList.remove("is-drag"); });
    bar.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); Player.seekBy(5); } else if (e.key === "ArrowLeft") { e.preventDefault(); Player.seekBy(-5); }
      else if (e.key === "Home") { e.preventDefault(); seek(0); } else if (e.key === "End") { e.preventDefault(); seek(.999); }
    });
  })();

  /* ================================================================ highlighter */
  var HKEY = "gpbook2.highlights", pop = $("#hlpop");
  var HL = {
    list: store(HKEY) || store("gpbook1.highlights") || [], range: null, editing: null,
    save: function () { store(HKEY, this.list); this.count(); },
    count: function () { var c = $("#hl-count"); c.hidden = !this.list.length; c.textContent = this.list.length; },
    offsets: function (el, range) { var pre = doc.createRange(); pre.selectNodeContents(el); pre.setEnd(range.startContainer, range.startOffset); var a = pre.toString().length; return [a, a + range.toString().length]; },
    pieces: function (range) {
      var out = [];
      Read.paras.forEach(function (p) {
        if (!range.intersectsNode(p)) return;
        var r = doc.createRange(); r.selectNodeContents(p);
        if (p.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset);
        if (p.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset);
        if (!r.toString().trim()) return;
        var o = HL.offsets(p, r); out.push({ pid: p.dataset.pid, start: o[0], end: o[1], text: r.toString() });
      });
      return out;
    },
    paint: function (h) {
      var el = book.querySelector('[data-pid="' + h.pid + '"]'); if (!el) return false;
      var txt = el.textContent;
      if (txt.slice(h.start, h.end) !== h.text) { var k = txt.indexOf(h.text); if (k < 0) return false; h.start = k; h.end = k + h.text.length; }
      var w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT), n, pos = 0, nodes = [];
      while ((n = w.nextNode())) { var len = n.nodeValue.length; if (pos + len > h.start && pos < h.end) nodes.push([n, Math.max(0, h.start - pos), Math.min(len, h.end - pos)]); pos += len; }
      nodes.forEach(function (x) {
        var node = x[0];
        if (x[2] < node.nodeValue.length) node.splitText(x[2]);
        if (x[1] > 0) node = node.splitText(x[1]);
        var m = doc.createElement("mark"); m.className = "hl hl-" + h.color + (h.note ? " has-note" : ""); m.dataset.hid = h.id;
        node.parentNode.insertBefore(m, node); m.appendChild(node);
      });
      return true;
    },
    unpaint: function (id) { $$('mark[data-hid="' + id + '"]', book).forEach(function (m) { var p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); m.remove(); p.normalize(); }); },
    restoreAll: function () { var self = this; this.list.forEach(function (h) { h.orphan = !self.paint(h); }); this.count(); },
    add: function (color) {
      if (!this.range) return null;
      var ps = this.pieces(this.range); if (!ps.length) return null;
      var group = "g" + Date.now().toString(36), self = this, made = [];
      ps.forEach(function (p, i) { var h = { id: group + "-" + i, group: group, pid: p.pid, start: p.start, end: p.end, text: p.text, color: String(color), note: "", at: new Date().toISOString() }; self.list.push(h); self.paint(h); made.push(h); });
      this.save(); window.getSelection().removeAllRanges(); this.range = null; this.hidePop();
      announce("Highlighted: " + made.map(function (h) { return h.text; }).join(" ").slice(0, 90));
      return made;
    },
    group: function (id) { var h = this.list.find(function (x) { return x.id === id; }); if (!h) return []; return this.list.filter(function (x) { return x.group === h.group; }); },
    recolor: function (id, color) { var self = this; this.group(id).forEach(function (h) { h.color = String(color); self.unpaint(h.id); self.paint(h); }); this.save(); this.renderPanel(); },
    remove: function (id) { var self = this, g = this.group(id); g.forEach(function (h) { self.unpaint(h.id); }); this.list = this.list.filter(function (h) { return g.indexOf(h) < 0; }); this.save(); this.renderPanel(); announce("Highlight removed."); },
    setNote: function (id, note) { var self = this; this.group(id).forEach(function (h, i) { h.note = i === 0 ? note : ""; self.unpaint(h.id); self.paint(h); }); this.save(); this.renderPanel(); },
    showPop: function (focusIt, hid) {
      var rect; this.editing = hid || null;
      $("#hlpop-del").hidden = !hid;
      $("#hlpop-note span").textContent = hid && this.group(hid)[0].note ? "Edit note" : "Note";
      $$(".hl-sw", pop).forEach(function (b) { b.setAttribute("aria-pressed", String(!!hid && HL.group(hid)[0].color === b.dataset.color)); });
      if (hid) rect = $('mark[data-hid="' + hid + '"]', book).getBoundingClientRect();
      else { if (!this.range) return; rect = this.range.getBoundingClientRect(); }
      pop.hidden = false;
      var pw = pop.offsetWidth, x = Math.min(Math.max(12, rect.left + rect.width / 2 - pw / 2 + scrollX), scrollX + root.clientWidth - pw - 12);
      var y = rect.top + scrollY - pop.offsetHeight - 12; if (rect.top < 140) y = rect.bottom + scrollY + 12;
      pop.style.left = x + "px"; pop.style.top = y + "px";
      if (focusIt) $(".hl-sw", pop).focus();
    },
    hidePop: function () { pop.hidden = true; this.editing = null; },
    renderPanel: function () {
      var groups = {}, order = [];
      this.list.forEach(function (h) { if (!groups[h.group]) { groups[h.group] = []; order.push(h.group); } groups[h.group].push(h); });
      $("#hl-empty").hidden = !!order.length; $("#hl-actions").hidden = !order.length;
      $("#hl-list").innerHTML = order.map(function (g) {
        var hs = groups[g], h = hs[0], el = book.querySelector('[data-pid="' + h.pid + '"]'), u = el && el.closest("section.unit");
        var where = u ? Read.labelFor(u) : "Not found in this version of the book";
        return '<li class="hl-item" data-hid="' + h.id + '"><p class="hl-where"><span class="hl-dot hl-dot--' + h.color + '" aria-hidden="true"></span>' + esc(where) + "</p>" +
          '<p class="hl-quote">' + esc(hs.map(function (x) { return x.text; }).join(" … ")) + "</p>" + (h.note ? '<p class="hl-note">' + esc(h.note) + "</p>" : "") +
          '<div class="hl-btns"><button type="button" class="mini-btn" data-act="go">Go to</button><button type="button" class="mini-btn" data-act="note">' + (h.note ? "Edit note" : "Add note") + "</button>" +
          ["1", "2", "3"].map(function (c) { return '<button type="button" class="mini-btn" data-act="color" data-color="' + c + '" aria-pressed="' + (h.color === c) + '"><span class="hl-dot hl-dot--' + c + '" aria-hidden="true"></span>' + ({ 1: "Lilac", 2: "Mint", 3: "Peach" })[c] + "</button>"; }).join("") +
          '<button type="button" class="mini-btn" data-act="del">Remove</button></div></li>';
      }).join("");
    },
    exportText: function () {
      var self = this, lines = [TITLE, "My highlights, exported " + new Date().toLocaleString(), ""], seen = {};
      this.list.forEach(function (h) {
        if (seen[h.group]) return; seen[h.group] = 1;
        var hs = self.list.filter(function (x) { return x.group === h.group; }), el = book.querySelector('[data-pid="' + h.pid + '"]'), u = el && el.closest("section.unit");
        lines.push(u ? Read.labelFor(u) : ""); lines.push("“" + hs.map(function (x) { return x.text; }).join(" … ") + "”");
        if (h.note) lines.push("Note: " + h.note); if (u) lines.push(linkFor("read/" + u.id)); lines.push("");
      });
      return lines.join("\n");
    }
  };
  function selectionInBook() { var sel = window.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return null; var r = sel.getRangeAt(0); if (!book.contains(r.commonAncestorContainer)) return null; if (!r.toString().trim()) return null; return r; }
  var selTimer;
  doc.addEventListener("selectionchange", function () {
    clearTimeout(selTimer);
    selTimer = setTimeout(function () {
      if (current !== "read" || Read.mode !== "scroll") return;
      var r = selectionInBook();
      if (r) { HL.range = r.cloneRange(); HL.showPop(false); }
      else if (!pop.contains(doc.activeElement) && !HL.editing) { HL.range = null; HL.hidePop(); }
    }, 180);
  });
  pop.addEventListener("mousedown", function (e) { e.preventDefault(); });
  pop.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.color) { if (HL.editing) { HL.recolor(HL.editing, b.dataset.color); HL.hidePop(); } else HL.add(b.dataset.color); return; }
    if (b.id === "hlpop-del") { var id = HL.editing; HL.hidePop(); HL.remove(id); return; }
    if (b.id === "hlpop-note") { var target = HL.editing ? HL.group(HL.editing)[0] : (HL.add("1") || [])[0]; HL.hidePop(); if (target) openNote(target.id, b); }
  });
  pop.addEventListener("keydown", function (e) {
    if (e.key === "Escape") HL.hidePop();
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { var bs = $$("button:not([hidden])", pop), i = bs.indexOf(doc.activeElement); if (i >= 0) { e.preventDefault(); bs[(i + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length].focus(); } }
  });
  book.addEventListener("click", function (e) { var m = e.target.closest("mark.hl"); if (!m || selectionInBook()) return; HL.range = null; HL.showPop(false, m.dataset.hid); });
  doc.addEventListener("mousedown", function (e) { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest("mark.hl") && HL.editing) HL.hidePop(); });
  var noteDlg = $("#note"), noteFor = null;
  function openNote(id, opener) {
    noteFor = id; var g = HL.group(id); $("#note-quote").textContent = g.map(function (h) { return h.text; }).join(" … "); $("#note-text").value = g[0].note || "";
    var back = opener && doc.contains(opener) && opener.offsetParent !== null ? opener : null;
    if (!back) { var mk = $('mark[data-hid="' + id + '"]', book); back = mk ? mk.closest("[data-pid]") : $("#t-hl"); if (back && !back.hasAttribute("tabindex")) back.setAttribute("tabindex", "-1"); }
    openDialog(noteDlg, back); setTimeout(function () { $("#note-text").focus(); }, 40);
  }
  $("#note-form").addEventListener("submit", function (e) { e.preventDefault(); if (noteFor) HL.setNote(noteFor, $("#note-text").value.trim()); announce("Note saved."); closeDialog(noteDlg); });
  $("#t-hl").addEventListener("click", function () { HL.renderPanel(); openDialog($("#hlpanel"), $("#t-hl").offsetParent ? $("#t-hl") : $("#t-more")); });
  $("#hl-list").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return; var id = b.closest(".hl-item").dataset.hid, act = b.dataset.act;
    if (act === "go") {
      $("#hlpanel")._opener = null; closeDialog($("#hlpanel"));
      var m = $('mark[data-hid="' + id + '"]', book);
      if (m) { Read.revealNear(m); m.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" }); m.classList.add("is-flash"); setTimeout(function () { m.classList.remove("is-flash"); }, 2400); var p = m.closest("[data-pid]"); p.setAttribute("tabindex", "-1"); p.focus({ preventScroll: true }); }
    } else if (act === "note") openNote(id, b);
    else if (act === "color") { HL.recolor(id, b.dataset.color); var nb = $('.hl-item[data-hid="' + id + '"] [data-color="' + b.dataset.color + '"]'); if (nb) nb.focus(); }
    else if (act === "del") { var li = b.closest(".hl-item"), next = li.nextElementSibling || li.previousElementSibling; HL.remove(id); var f = next && $('.hl-item[data-hid="' + next.dataset.hid + '"] button'); (f || $("#hlpanel .close")).focus(); }
  });
  $("#hl-export").addEventListener("click", function () {
    var blob = new Blob([HL.exportText()], { type: "text/plain;charset=utf-8" }), a = doc.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "designing-trust-highlights.txt"; doc.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    announce("Highlights exported as a text file.");
  });
  $("#hl-copy").addEventListener("click", async function () { var ok = await copyText(HL.exportText()); announce(ok ? "Highlights copied." : "Could not copy."); var b = this; b.textContent = ok ? "Copied" : "Copy failed"; setTimeout(function () { b.textContent = "Copy all"; }, 2000); });
  $("#hl-clear").addEventListener("click", function () {
    if (!confirm("Remove all highlights and notes from this device?")) return;
    HL.list.forEach(function (h) { HL.unpaint(h.id); }); HL.list = []; HL.save(); HL.renderPanel(); announce("All highlights removed."); $("#hlpanel .close").focus();
  });

  /* ================================================================ focus */
  var Focus = {
    on: false, cur: null,
    set: function (v) {
      this.on = v; root.classList.toggle("focus-on", v); $("#t-focus").setAttribute("aria-pressed", String(v));
      if (!v && this.cur) { this.cur.classList.remove("is-focus"); var f = this.cur.closest(".figure"); if (f) f.classList.remove("is-focus"); this.cur = null; }
      if (v) this.update();
    },
    update: function () {
      if (!this.on) return;
      var line = innerHeight * 0.42, best = null, bd = 1e9;
      for (var i = 0; i < Read.paras.length; i++) {
        var r = Read.paras[i].getBoundingClientRect(); if (r.bottom < 0) continue; if (r.top > innerHeight) break;
        var d = r.top <= line && r.bottom >= line ? 0 : Math.min(Math.abs(r.top - line), Math.abs(r.bottom - line));
        if (d < bd) { bd = d; best = Read.paras[i]; }
      }
      if (best && best !== this.cur) {
        if (this.cur) { this.cur.classList.remove("is-focus"); var of = this.cur.closest(".figure"); if (of) of.classList.remove("is-focus"); }
        best.classList.add("is-focus"); var fg = best.closest(".figure"); if (fg) fg.classList.add("is-focus"); this.cur = best;
      }
    }
  };
  $("#t-focus").addEventListener("click", function () { Focus.set(!Focus.on); announce(Focus.on ? "Focus on. Everything but the paragraph you are reading is dimmed." : "Focus off."); });

  /* ================================================================ boot */
  async function boot() {
    apply();
    await gate();
    $("#app").hidden = false;
    pageMap();
    var m = store("gpbook2.mode"); if (m === "book" && /^#read\/?$/.test(location.hash)) location.hash = "#read/book";
    await route(true);
    if (!S.setupDone) await runFirst();
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") navigator.serviceWorker.register("sw.js").catch(function () {});
  }
  window.__gp = { S: S, HL: HL, TTS: TTS, Read: Read, Book: Book, Player: Player, Home: Home, AudioOwner: AudioOwner, openPz: openPz, finishFirst: finishFirst };
  boot();
})();
