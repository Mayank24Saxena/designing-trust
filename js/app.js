/* Designing Trust in Self-Administered Colorectal Cancer Screening — digital edition v1.1. No dependencies (QR via bundled qrcode-generator, MIT). */
(function () {
  "use strict";
  var doc = document, root = doc.documentElement, CFG = window.SITE_CONFIG || {};
  var $ = function (s, el) { return (el || doc).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(s)); };
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function announce(t) { var a = $("#announce"); a.textContent = ""; setTimeout(function () { a.textContent = t; }, 40); }
  function mq(q) { try { return matchMedia(q).matches; } catch (e) { return false; } }
  function reduced() { return root.dataset.motion === "reduce"; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ================================================================ settings */
  var SKEY = "gpbook1.settings";
  var DEF = { theme: null, size: 19, font: "sans", spacing: "default", motion: null, measure: 66, setupDone: false };
  var S = Object.assign({}, DEF, store(SKEY) || {});
  function apply() {
    root.dataset.theme = S.theme || (mq("(prefers-contrast: more)") ? "contrast" : mq("(prefers-color-scheme: dark)") ? "dark" : "light");
    root.dataset.font = S.font;
    root.dataset.spacing = S.spacing;
    root.dataset.motion = (S.motion === "reduce" || (!S.motion && mq("(prefers-reduced-motion: reduce)"))) ? "reduce" : "on";
    root.style.setProperty("--fs", S.size + "px");
    root.style.setProperty("--measure", S.measure + "ch");
    var m = $('meta[name="theme-color"]'); if (m) m.content = getComputedStyle(root).getPropertyValue("--bg").trim();
  }
  function save() { store(SKEY, S); }
  apply();
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply); matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", apply); } catch (e) {}

  var form = $("#settings-form");
  function syncForm() {
    var eff = { theme: root.dataset.theme, font: S.font, spacing: S.spacing, motion: root.dataset.motion };
    ["theme", "font", "spacing", "motion"].forEach(function (n) { $$('input[name="' + n + '"]', form).forEach(function (r) { r.checked = r.value === eff[n]; }); });
    form.elements.size.value = S.size; $("#out-size").value = S.size + " px"; form.elements.size.setAttribute("aria-valuetext", S.size + " pixels");
    form.elements.measure.value = S.measure; $("#out-measure").value = S.measure + " ch"; form.elements.measure.setAttribute("aria-valuetext", S.measure + " characters per line");
  }
  form.addEventListener("input", function (e) {
    var t = e.target;
    if (t.name === "size" || t.name === "measure") S[t.name] = Number(t.value);
    else if (t.name) S[t.name] = t.value;
    apply(); save(); syncForm();
    if (Read.loaded) Read.onLayout();
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  $("#settings-reset").addEventListener("click", function () { var done = S.setupDone; S = Object.assign({}, DEF, { setupDone: done }); apply(); save(); syncForm(); announce("Settings reset."); });

  /* ================================================================ dialogs */
  function openDialog(d, opener) {
    d._opener = opener || doc.activeElement;
    if (!d.open) d.showModal();
  }
  function closeDialog(d) { if (d && d.open) d.close(); }
  $$("dialog").forEach(function (d) {
    d.addEventListener("click", function (e) { if (e.target === d && !d.classList.contains("is-setup")) closeDialog(d); });
    d.addEventListener("close", function () { var o = d._opener; d._opener = null; if (o && o.focus && doc.contains(o)) o.focus({ preventScroll: true }); });
  });
  doc.addEventListener("click", function (e) {
    var c = e.target.closest && e.target.closest("[data-close]");
    if (c) { var d = c.closest("dialog"); if (d.id === "settings") closeSettings(); else closeDialog(d); }
  });

  /* settings panel: grows out of the settings button, and shrinks back into it */
  var panel = $("#settings"), sBtn = $("#t-settings");
  function flipFromButton(el, reverse) {
    // returns a promise resolved when the transform animation is done
    if (reduced()) return Promise.resolve();
    var p = el.getBoundingClientRect(), b = sBtn.getBoundingClientRect();
    var sx = b.width / p.width, sy = b.height / p.height;
    var dx = b.left - p.left, dy = b.top - p.top;
    var shrunk = "translate(" + dx + "px," + dy + "px) scale(" + sx + "," + sy + ")";
    el.style.transformOrigin = "0 0";
    el.style.animation = "none";
    return new Promise(function (resolve) {
      if (reverse) {          // minimise: full -> button
        el.classList.add("is-minimising");
        el.style.transform = "none";
        requestAnimationFrame(function () { requestAnimationFrame(function () { el.style.transform = shrunk; el.style.borderRadius = "999px"; el.style.opacity = "0"; }); });
      } else {                // grow: button -> full
        el.classList.add("is-growing");
        el.style.transition = "none"; el.style.transform = shrunk; el.style.borderRadius = "999px";
        el.getBoundingClientRect();
        el.style.transition = "transform .7s var(--ease), border-radius .7s var(--ease)";
        el.style.transform = "none"; el.style.borderRadius = "";
        setTimeout(function () { el.classList.remove("is-growing"); }, 380);
      }
      setTimeout(resolve, reverse ? 860 : 720);
    });
  }
  function resetPanelStyles() { panel.classList.remove("is-minimising", "is-growing"); ["transform", "transition", "transformOrigin", "borderRadius", "opacity", "animation"].forEach(function (k) { panel.style[k] = ""; }); }
  function openSettings(opener) {
    panel.classList.remove("is-setup");
    $("#settings-title").textContent = "Settings";
    syncForm(); openDialog(panel, opener || sBtn);
    flipFromButton(panel, false).then(resetPanelStyles);
  }
  function closeSettings() { flipFromButton(panel, true).then(function () { closeDialog(panel); resetPanelStyles(); }); }
  sBtn.addEventListener("click", function () { openSettings(sBtn); });
  panel.addEventListener("cancel", function (e) { e.preventDefault(); if (panel.classList.contains("is-setup")) finishSetup(false); else closeSettings(); });

  /* first-run setup: the same panel, then it minimises into the settings button */
  function runSetup() {
    return new Promise(function (resolve) {
      panel.classList.add("is-setup");
      $("#settings-title").textContent = "Make it comfortable to read";
      syncForm(); openDialog(panel, null); panel._resolve = resolve;
      setTimeout(function () { var f = panel.querySelector('input[name="theme"]:checked') || panel.querySelector("input"); if (f) f.focus(); }, 60);
    });
  }
  function finishSetup(ok) {
    S.setupDone = true; save();
    panel._opener = null;
    flipFromButton(panel, true).then(function () {
      closeDialog(panel); resetPanelStyles(); panel.classList.remove("is-setup");
      sBtn.classList.add("is-pulse"); setTimeout(function () { sBtn.classList.remove("is-pulse"); }, 3400);
      announce(ok ? "Settings saved. You can change them any time with the Settings button, top right." : "Setup skipped. Settings are in the Settings button, top right.");
      var r = panel._resolve; panel._resolve = null; if (r) r();
    });
  }
  $("#setup-ok").addEventListener("click", function () { finishSetup(true); });
  $("#setup-skip").addEventListener("click", function () { finishSetup(false); });

  /* ================================================================ gate */
  async function gate() {
    var q = new URLSearchParams(location.search);
    if (CFG.gate === false || (CFG.allowBypassParam && q.has("nogate"))) { Vault.bypass(); return; }
    if (await Vault.restore()) return;
    var g = $("#gate"), f = $("#gate-form"), input = $("#gate-code"), msg = $("#gate-msg");
    g.hidden = false;
    // focus the field only where it won't pop a keyboard over the letter (fine pointer = desktop)
    if (mq("(pointer: fine)")) setTimeout(function () { input.focus({ preventScroll: true }); }, 30);
    await new Promise(function (resolve) {
      f.addEventListener("submit", async function (e) {
        e.preventDefault();
        var code = input.value;
        if (!code.trim()) { msg.textContent = "Please enter the access code."; return; }
        msg.textContent = "Checking…";
        var ok = false; try { ok = await Vault.unlock(code); } catch (err) { ok = false; }
        if (!ok) {
          msg.textContent = "That code didn’t work. Check it and try again.";
          g.classList.remove("is-wrong"); void g.offsetWidth; g.classList.add("is-wrong"); input.select(); return;
        }
        msg.textContent = "";
        g.classList.add("is-leaving");
        await wait(reduced() ? 0 : 600);
        g.hidden = true; g.classList.remove("is-leaving"); resolve();
      });
    });
  }

  /* ================================================================ router */
  var views = { home: $("#view-home"), read: $("#view-read"), listen: $("#view-listen"), watch: $("#view-watch") };
  var current = null;
  function parse(h) {
    h = decodeURIComponent((h || "").replace(/^#\/?/, ""));
    if (!h || h === "home") return { view: "home" };
    if (h === "share") return { view: "read", target: null, share: true };
    var m = h.match(/^(read|listen|watch)(?:\/(.+))?$/);
    if (m) return { view: m[1], target: m[2] || null };
    return { view: "read", target: h };     // v0 style links (#ch-05, #fig-2-3) open the book there
  }
  async function route(initial) {
    var r = parse(location.hash);
    if (current !== r.view) {
      Object.keys(views).forEach(function (k) { views[k].hidden = k !== r.view; });
      current = r.view;
      $("#bar-tools").hidden = r.view !== "read";
      $(".bar-home").hidden = r.view === "home";
      doc.body.classList.toggle("in-read", r.view === "read");
      $("#readbar").hidden = r.view !== "read";
      $("#bar-where").classList.toggle("is-on", r.view === "read");
      if (r.view !== "read") { TTS.stop(); Focus.set(false); HL.hidePop(); }
      doc.title = ({ home: "", read: "Read — ", listen: "Listen — ", watch: "Watch — " }[r.view]) + "Designing Trust in Self-Administered Colorectal Cancer Screening · Mayank Saxena";
    }
    if (r.view === "home") {
      Home.init();
      window.scrollTo({ top: 0, behavior: "instant" }); if (!initial) $("#home-title").focus({ preventScroll: true });
    } else if (r.view === "read") {
      await Read.load();
      await Read.go(r.target, initial);
      if (r.share) Share.open();
    } else {
      Media.show(r.view, r.target);
      window.scrollTo({ top: 0, behavior: "instant" }); if (!initial) $("#" + r.view + "-title").focus({ preventScroll: true });
    }
  }
  window.addEventListener("hashchange", function () { route(false); });

  /* ================================================================ manifests */
  var manifests = {};
  async function manifest(name) {
    if (manifests[name]) return manifests[name];
    try { manifests[name] = await getAsset(name + "/manifest.json", "json"); } catch (e) { manifests[name] = {}; }
    return manifests[name];
  }
  function audioOn(m) { var c = (m && m.chapters) || {}; return Object.keys(c).some(function (k) { return !!c[k]; }); }

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

  /* ================================================================ home */
  var Home = {
    done: false,
    init: async function () {
      if (this.done) return; this.done = true;
      var size = CFG.epubBytes ? " (" + (CFG.epubBytes / 1e6).toFixed(1) + " MB)" : "";
      $("#epub-size").textContent = size;
      $("#epub-link").addEventListener("click", async function (e) {
        if (!CFG.encrypted) return;              // plain build: the link is the file
        e.preventDefault();
        var url = await getAsset("media/Mayank-GP-Book.epub", "url"); var a = doc.createElement("a"); a.href = url; a.download = "Mayank-GP-Book.epub"; doc.body.appendChild(a); a.click(); a.remove();
      });
      var am = await manifest("audio"), vm = await manifest("video");
      var aOn = audioOn(am), vOn = !!(vm && vm.youtube);
      $("#listen-soon").hidden = aOn; $("#choice-listen").classList.toggle("is-soon", !aOn);
      $("#watch-soon").hidden = vOn; $("#choice-watch").classList.toggle("is-soon", !vOn);
    }
  };

  /* ================================================================ listen / watch */
  var Media = {
    show: async function (which, target) {
      if (which === "listen") {
        var m = await manifest("audio"), body = $("#listen-body");
        if (!audioOn(m)) { body.innerHTML = soon("The audiobook is being recorded.", "Until then, the book can read itself aloud: open Read and press Read aloud."); return; }
        var toc = await getAsset("data/toc.json", "json");
        var items = toc.filter(function (u) { return m.chapters[u.id]; });
        body.innerHTML = '<ol class="tracks">' + items.map(function (u) {
          var e = m.chapters[u.id], src = typeof e === "string" ? e : e.src;
          var label = (u.num ? esc(u.num) + " " : "") + esc(u.title);
          if (CFG.encrypted) {   // decrypt a track only when it is asked for, one at a time
            return '<li id="listen-' + esc(u.id) + '"><span>' + label + '</span><div class="track"><button type="button" class="track-play" data-src="' + esc(src) +
              '" aria-label="Play ' + esc(u.title) + '"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7L8 5Z" fill="currentColor"/></svg><span>Play</span></button>' +
              '<audio controls preload="none" hidden aria-label="' + esc(u.title) + '"></audio></div></li>';
          }
          return '<li id="listen-' + esc(u.id) + '"><span>' + label + '</span><audio controls preload="none" src="' + esc(src) + '" aria-label="' + esc(u.title) + '"></audio></li>';
        }).join("") + "</ol>";
        if (CFG.encrypted && !body._wired) {
          body._wired = true;
          body.addEventListener("click", async function (ev) {
            var btn = ev.target.closest(".track-play"); if (!btn) return;
            var li = btn.closest("li"), au = li.querySelector("audio");
            if (Media.active && Media.active.li !== li) {        // free the previous track's memory
              var o = Media.active; o.au.pause(); o.au.removeAttribute("src"); o.au.load(); URL.revokeObjectURL(o.url);
              o.au.hidden = true; o.btn.hidden = false; Media.active = null;
            }
            btn.disabled = true; btn.querySelector("span").textContent = "Opening…";
            try {
              var url = await getAsset(btn.dataset.src, "url");
              au.src = url; au.hidden = false; btn.hidden = true; Media.active = { li: li, au: au, btn: btn, url: url };
              au.focus();
              var pr = au.play(); if (pr && pr.catch) pr.catch(function () { announce("Ready. Press play to listen."); });
            } catch (err) { announce("This track could not be opened."); }
            btn.disabled = false; btn.querySelector("span").textContent = "Play";
          });
        }
        if (target) { var el = $("#listen-" + CSS.escape(target)); if (el) el.scrollIntoView({ block: "center" }); }
      } else {
        var v = await manifest("video"), wb = $("#watch-body");
        if (!v || !v.youtube) { wb.innerHTML = soon("The film is in the edit.", "It will appear here as soon as it is ready."); return; }
        wb.innerHTML = '<div class="yt"><iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(v.youtube) + '?rel=0" title="' + esc(v.title || "Film") + '" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>';
      }
      function soon(a, b) { return '<div class="media-soon"><b>Coming soon.</b><span>' + esc(a) + " " + esc(b) + '</span><a href="#read">Open the book</a></div>'; }
    }
  };

  /* ================================================================ read */
  var book = $("#book");
  var Read = {
    loaded: false, loading: null, units: [], heads: [], paras: [], holdHash: 0,
    load: function () {
      if (this.loading) return this.loading;
      var self = this;
      this.loading = getAsset("data/book.html", "text").then(function (html) {
        book.innerHTML = html; book.setAttribute("aria-busy", "false");
        self.loaded = true; self.units = $$("section.unit", book);
        self.paras = $$("[data-pid]", book);
        self.buildNav(); self.lazy(); self.spy(); HL.restoreAll(); Focus.bind();
      }).catch(function (e) { book.innerHTML = '<p class="book-loading">The book could not be opened (' + esc(e.message) + ").</p>"; });
      return this.loading;
    },
    buildNav: function () {
      var html = "", lastGroup = null;
      this.units.forEach(function (u) {
        var kind = u.dataset.kind, group = kind === "front" ? "Front matter" : kind === "end" ? "End matter" : null;
        if (kind === "part") group = "Part " + u.dataset.num;
        if (group && group !== lastGroup) { html += '<li class="sn-group" aria-hidden="true">' + esc(group) + "</li>"; lastGroup = group; }
        if (kind === "part") return;   // parts are listed as group labels; the link goes on the label row below
        var subs = $$("h2[id]", u);
        var n = kind === "chapter" && u.dataset.num ? u.dataset.num : "";
        html += '<li data-unit="' + u.id + '"><div class="sn-row"><a class="sn-link" href="#read/' + u.id + '">' + (n ? '<span class="n">' + esc(n) + "</span>" : "") + "<span>" + esc(u.dataset.title) + "</span></a>" +
          (subs.length ? '<button type="button" class="sn-toggle" aria-expanded="false" aria-label="Sections in ' + esc(u.dataset.title) + '"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' : "") +
          "</div>" + (subs.length ? '<ol class="sn-sub" hidden>' + subs.map(function (h) { return '<li><a class="sn-link" href="#read/' + h.id + '">' + esc(h.textContent) + "</a></li>"; }).join("") + "</ol>" : "") + "</li>";
      });
      // part rows: make the group labels themselves links
      $("#secnav-list").innerHTML = html;
      $("#navsheet-list").innerHTML = html;
      $$(".sn-group").forEach(function (g) {
        var m = g.textContent.match(/^Part (\d)/); if (!m) return;
        var u = $("#part-" + m[1]); if (!u) return;
        g.removeAttribute("aria-hidden");
        g.innerHTML = '<a class="sn-link" href="#read/part-' + m[1] + '"><span class="n">' + m[1] + "</span><span>" + esc(u.dataset.title) + "</span></a>";
        g.classList.add("sn-group--part"); g.setAttribute("data-unit", "part-" + m[1]);
      });
      $$(".secnav-list").forEach(function (list) {
        list.addEventListener("click", function (e) {
          var t = e.target.closest(".sn-toggle"); if (t) { toggle(t); return; }
          var a = e.target.closest("a"); if (a && list.id === "navsheet-list") closeDialog($("#navsheet"));
        });
      });
      function toggle(t, force) {
        var open = force !== undefined ? force : t.getAttribute("aria-expanded") !== "true";
        t.setAttribute("aria-expanded", String(open)); t.closest("li").querySelector(".sn-sub").hidden = !open;
      }
      this.toggle = toggle;
      $("#rail").addEventListener("click", function () { openDialog($("#navsheet"), $("#rail")); Read.markNav(Read.cur, true); });
    },
    lazy: function () {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return; io.unobserve(e.target);
          var img = e.target, p = img.getAttribute("data-src");
          getAsset(p, "url").then(function (u) {
            img.onload = function () { img.classList.add("is-loaded"); };
            img.src = u;
          });
        });
      }, { rootMargin: "1200px 0px" });
      $$("img.lazy", book).forEach(function (i) { io.observe(i); });
      this.lazyIO = io;
    },
    loadNow: function (el) {      // force-load images near a deep-link target so layout settles before scrolling
      var imgs = $$("img.lazy:not(.is-loaded)", el.closest("section.unit") || book);
      return Promise.all(imgs.slice(0, 40).map(function (img) {
        return getAsset(img.getAttribute("data-src"), "url").then(function (u) { if (img.src.indexOf("data:") === 0) { img.src = u; img.classList.add("is-loaded"); } });
      }));
    },
    cur: null,
    spy: function () {
      var self = this;
      this.heads = $$("section.unit, h2[id]", book);
      var ticking = false;
      function onScroll() {
        ticking = false;
        var y = (doc.querySelector(".bar").offsetHeight || 64) + window.innerHeight * 0.25, best = null;
        for (var i = 0; i < self.heads.length; i++) { var top = self.heads[i].getBoundingClientRect().top; if (top <= y) best = self.heads[i]; else break; }
        best = best || self.heads[0];
        if (best && best !== self.cur) { self.cur = best; self.markNav(best); }
        var max = doc.documentElement.scrollHeight - window.innerHeight, p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
        $("#readbar-fill").style.width = (p * 100).toFixed(2) + "%"; $("#readbar").setAttribute("aria-valuenow", String(Math.round(p * 100)));
        $("#rail-fill").style.height = (p * 100).toFixed(2) + "%";
        Focus.update();
      }
      window.addEventListener("scroll", function () { if (!ticking && current === "read") { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
      window.addEventListener("resize", function () { if (current === "read") onScroll(); });
      this.onLayout = onScroll;
      setTimeout(onScroll, 50);
    },
    markNav: function (el, scrollSheet) {
      var unit = el.matches("section.unit") ? el : el.closest("section.unit");
      var id = el.id, uid = unit.id;
      $$(".secnav-list").forEach(function (list) {
        $$("[aria-current]", list).forEach(function (a) { a.removeAttribute("aria-current"); });
        var row = $('[data-unit="' + uid + '"]', list);
        if (!row) return;
        var link = $('a[href="#read/' + uid + '"]', row); if (link) link.setAttribute("aria-current", "location");
        if (id !== uid) { var sub = $('a[href="#read/' + id + '"]', row); if (sub) sub.setAttribute("aria-current", "true"); }
        var t = $(".sn-toggle", row);
        $$(".sn-toggle[aria-expanded=true]", list).forEach(function (o) { if (o !== t && !o._pinned) Read.toggle(o, false); });
        if (t) Read.toggle(t, true);
        if (list.id === "secnav-list" || scrollSheet) {
          var a = $("[aria-current]", row), box = list.closest(".secnav-scroll, dialog");
          if (a && box) { var r = a.getBoundingClientRect(), b = box.getBoundingClientRect(); if (r.top < b.top + 60 || r.bottom > b.bottom - b.height / 3) box.scrollTop += r.top - b.top - b.height / 4; }
        }
      });
      $("#bar-where").textContent = (unit.dataset.label ? unit.dataset.label + " · " : "") + unit.dataset.title;
      if (current === "read" && history.replaceState && Date.now() > Read.holdHash) {
        var h = "#read/" + (id || uid);
        if (location.hash !== h) history.replaceState(null, "", h);
      }
    },
    go: async function (target, initial) {
      var el = null;
      if (target) {
        el = doc.getElementById(target);
        if (!el) {   // tolerant deep links: ch-5, chapter-5, fig-2.3, figure-2-3
          var l = target.toLowerCase().replace(/\./g, "-"), m;
          if ((m = l.match(/^(?:ch|chapter)-?(\d{1,2})(-\d+)?$/))) l = "ch-" + ("0" + m[1]).slice(-2) + (m[2] || "");
          else if ((m = l.match(/^(fig|figure|plate|table)-?(p?\d+)-(\d+)$/))) l = ({ figure: "fig" }[m[1]] || m[1]) + "-" + m[2] + "-" + m[3];
          el = doc.getElementById(l);
        }
      }
      if (!el) { if (initial || !target) window.scrollTo({ top: 0, behavior: "instant" }); return; }
      this.holdHash = Date.now() + 1500;   // keep the deep link in the address bar until the reader scrolls
      await this.loadNow(el);
      var scroller = function () { el.scrollIntoView({ block: "start", behavior: "instant" }); };
      scroller(); requestAnimationFrame(scroller);
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

  /* ================================================================ share a section */
  var Share = {
    open: function () {
      var el = Read.cur || (Read.units[0] || null); if (!el) return;
      var unit = el.matches("section.unit") ? el : el.closest("section.unit");
      var where = (unit.dataset.label ? unit.dataset.label + " · " : "") + unit.dataset.title + (el !== unit ? " · " + el.textContent : "");
      this.url = linkFor("read/" + el.id); this.name = where;
      $("#share-where").textContent = where; $("#share-url").textContent = this.url;
      $("#share-qr-box").hidden = true; $("#share-qr-box").innerHTML = ""; $("#share-qr").setAttribute("aria-expanded", "false"); $("#share-qr").textContent = "Show QR code";
      $("#share-native").hidden = !navigator.share;
      openDialog($("#sharebox"), $("#t-share"));
    }
  };
  $("#t-share").addEventListener("click", function () { Share.open(); });
  $(".modes-nav--sheet").addEventListener("click", function (e) { if (e.target.closest("a")) { $("#navsheet")._opener = null; closeDialog($("#navsheet")); } });
  $("#share-copy").addEventListener("click", async function () {
    var b = this, ok = await copyText(Share.url); b.textContent = ok ? "Copied" : "Copy failed";
    announce(ok ? "Link copied." : "Could not copy the link."); setTimeout(function () { b.textContent = "Copy link"; }, 2200);
  });
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
      sStatus.textContent = r.length ? (r.length === 60 ? "Showing the first 60 results." : r.length + (r.length === 1 ? " result." : " results.")) : "No results.";
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
    if (current !== "read" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); openSearch(); }
    if ((e.key === "h" || e.key === "H") && HL.range) { e.preventDefault(); HL.showPop(true); }
  });

  /* ================================================================ read aloud (Web Speech API) */
  var synth = window.speechSynthesis;
  var TTS = {
    on: false, paused: false, pi: -1, si: 0, sents: [], voice: null, rate: 1, token: 0,
    readable: function () { return Read.paras.filter(function (p) { return !p.closest(".fig-missing") && p.offsetParent !== null; }); },
    startIndex: function () {
      var list = this.readable(), top = ($("#bar").offsetHeight || 64) + 8;
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
      sel.innerHTML = en.length ? en.map(function (v, i) { return '<option value="' + i + '">' + esc(v.name.replace(/^(Microsoft|Google)\s+/, "")) + " (" + esc(v.lang) + ")</option>"; }).join("") : '<option value="">Device voice</option>';
      this._list = en;
      var pref = store("gpbook1.voice"); var k = en.findIndex(function (v) { return v.name === pref; });
      if (k < 0) k = Math.max(0, en.findIndex(function (v) { return /en-(GB|IN)/i.test(v.lang); }));
      if (en.length) { sel.value = String(k); this.voice = en[k]; }
    },
    start: function () {
      if (!synth) { announce("Read aloud is not available in this browser."); return; }
      this.on = true; this.paused = false; $("#tts").hidden = false; $("#tts").classList.remove("is-paused");
      $("#t-aloud").setAttribute("aria-pressed", "true"); $("#tts-play").setAttribute("aria-label", "Pause");
      if (!this._list) this.voices();
      var r = store("gpbook1.rate"); if (r) { this.rate = r; $("#tts-rate").value = String(r); }
      this.list = this.readable(); this.pi = this.startIndex(); this.si = 0; this.prepare(); this.speak();
      announce("Reading aloud from: " + this.list[this.pi].textContent.slice(0, 80));
    },
    prepare: function () { var el = this.list[this.pi]; this.text = el ? el.textContent : ""; this.sents = this.split(this.text); },
    mark: function () {
      var el = this.list[this.pi]; $$(".is-reading", book).forEach(function (x) { x.classList.remove("is-reading"); }); if (!el) return;
      el.classList.add("is-reading");
      var s = this.sents[this.si] || [0, this.text.length], range = this.rangeFor(el, s[0], s[1]);
      if (window.CSS && CSS.highlights && range) { CSS.highlights.set("tts", new Highlight(range)); }
      var rect = range ? range.getBoundingClientRect() : el.getBoundingClientRect(), top = ($("#bar").offsetHeight || 64);
      if (rect.top < top + 20 || rect.bottom > window.innerHeight - 140) {
        window.scrollTo({ top: scrollY + rect.top - window.innerHeight * 0.35, behavior: reduced() ? "auto" : "smooth" });
      }
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
      u.onerror = function (ev) { if (tok !== self.token) return; if (ev.error !== "interrupted" && ev.error !== "canceled") { $("#tts-status").textContent = (self._list && self._list.length) ? "This device could not speak the text (" + ev.error + ")." : "No speech voice is installed on this device. The highlighted sentence shows where reading would be."; } };
      synth.cancel(); synth.speak(u);
      $("#tts-status").textContent = (this._list && this._list.length) ? "" : "No speech voices found on this device.";
    },
    pause: function () { this.paused = true; this.token++; synth.cancel(); $("#tts").classList.add("is-paused"); $("#tts-play").setAttribute("aria-label", "Play"); },
    resume: function () { this.paused = false; $("#tts").classList.remove("is-paused"); $("#tts-play").setAttribute("aria-label", "Pause"); this.speak(); },
    step: function (d) { this.pi = Math.max(0, Math.min(this.list.length - 1, this.pi + d)); this.si = 0; this.prepare(); if (this.paused) this.mark(); else this.speak(); },
    stop: function () {
      if (!this.on) return; this.on = false; this.token++; if (synth) synth.cancel();
      $("#tts").hidden = true; $("#t-aloud").setAttribute("aria-pressed", "false");
      if (window.CSS && CSS.highlights) CSS.highlights.delete("tts");
      $$(".is-reading", book).forEach(function (x) { x.classList.remove("is-reading"); });
    }
  };
  if (synth) { synth.addEventListener ? synth.addEventListener("voiceschanged", function () { TTS.voices(); }) : (synth.onvoiceschanged = function () { TTS.voices(); }); }
  $("#t-aloud").addEventListener("click", function () { if (TTS.on) TTS.stop(); else TTS.start(); });
  $("#tts-play").addEventListener("click", function () { if (TTS.paused) TTS.resume(); else TTS.pause(); });
  $("#tts-prev").addEventListener("click", function () { TTS.step(-1); });
  $("#tts-next").addEventListener("click", function () { TTS.step(1); });
  $("#tts-stop").addEventListener("click", function () { TTS.stop(); $("#t-aloud").focus(); });
  $("#tts-rate").addEventListener("change", function () { TTS.rate = Number(this.value); store("gpbook1.rate", TTS.rate); if (TTS.on && !TTS.paused) TTS.speak(); });
  $("#tts-voice").addEventListener("change", function () { TTS.voice = TTS._list && TTS._list[Number(this.value)]; if (TTS.voice) store("gpbook1.voice", TTS.voice.name); if (TTS.on && !TTS.paused) TTS.speak(); });
  window.addEventListener("pagehide", function () { TTS.stop(); });

  /* ================================================================ highlighter */
  var HKEY = "gpbook1.highlights", pop = $("#hlpop");
  var HL = {
    list: store(HKEY) || [], range: null, editing: null,
    save: function () { store(HKEY, this.list); this.count(); },
    count: function () { var c = $("#hl-count"); c.hidden = !this.list.length; c.textContent = this.list.length; },
    offsets: function (el, range) {
      var pre = doc.createRange(); pre.selectNodeContents(el); pre.setEnd(range.startContainer, range.startOffset);
      var a = pre.toString().length; return [a, a + range.toString().length];
    },
    pieces: function (range) {   // split a selection into one piece per paragraph
      var out = [];
      Read.paras.forEach(function (p) {
        if (!range.intersectsNode(p)) return;
        var r = doc.createRange(); r.selectNodeContents(p);
        if (p.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset);
        if (p.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset);
        if (!r.toString().trim()) return;
        // skip nested pids (a li containing a p is not used, so parents are fine)
        var o = HL.offsets(p, r); out.push({ pid: p.dataset.pid, start: o[0], end: o[1], text: r.toString() });
      });
      return out;
    },
    paint: function (h) {
      var el = book.querySelector('[data-pid="' + h.pid + '"]'); if (!el) return false;
      var txt = el.textContent;
      if (txt.slice(h.start, h.end) !== h.text) {         // content moved: find the text again
        var k = txt.indexOf(h.text); if (k < 0) return false; h.start = k; h.end = k + h.text.length;
      }
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
    unpaint: function (id) {
      $$('mark[data-hid="' + id + '"]', book).forEach(function (m) { var p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); m.remove(); p.normalize(); });
    },
    restoreAll: function () { var self = this; this.list.forEach(function (h) { h.orphan = !self.paint(h); }); this.count(); },
    add: function (color) {
      if (!this.range) return null;
      var ps = this.pieces(this.range); if (!ps.length) return null;
      var group = "g" + Date.now().toString(36), self = this, made = [];
      ps.forEach(function (p, i) {
        var h = { id: group + "-" + i, group: group, pid: p.pid, start: p.start, end: p.end, text: p.text, color: String(color), note: "", at: new Date().toISOString() };
        self.list.push(h); self.paint(h); made.push(h);
      });
      this.save(); window.getSelection().removeAllRanges(); this.range = null; this.hidePop();
      announce("Highlighted: " + made.map(function (h) { return h.text; }).join(" ").slice(0, 90));
      return made;
    },
    group: function (id) { var h = this.list.find(function (x) { return x.id === id; }); if (!h) return []; return this.list.filter(function (x) { return x.group === h.group; }); },
    recolor: function (id, color) { var self = this; this.group(id).forEach(function (h) { h.color = String(color); self.unpaint(h.id); self.paint(h); }); this.save(); this.renderPanel(); },
    remove: function (id) { var self = this, g = this.group(id); g.forEach(function (h) { self.unpaint(h.id); }); this.list = this.list.filter(function (h) { return g.indexOf(h) < 0; }); this.save(); this.renderPanel(); announce("Highlight removed."); },
    setNote: function (id, note) { var self = this; this.group(id).forEach(function (h, i) { h.note = i === 0 ? note : ""; self.unpaint(h.id); self.paint(h); }); this.save(); this.renderPanel(); },
    /* popover */
    showPop: function (focusIt, hid) {
      var rect;
      this.editing = hid || null;
      $("#hlpop-del").hidden = !hid;
      $("#hlpop-note").textContent = hid && this.group(hid)[0].note ? "Edit note" : "Add note";
      $$(".hl-sw", pop).forEach(function (b) { b.setAttribute("aria-pressed", String(!!hid && HL.group(hid)[0].color === b.dataset.color)); });
      if (hid) rect = $('mark[data-hid="' + hid + '"]', book).getBoundingClientRect();
      else { if (!this.range) return; rect = this.range.getBoundingClientRect(); }
      pop.hidden = false;
      var pw = pop.offsetWidth, x = Math.min(Math.max(12, rect.left + rect.width / 2 - pw / 2 + scrollX), scrollX + doc.documentElement.clientWidth - pw - 12);
      var y = rect.top + scrollY - pop.offsetHeight - 12; if (rect.top < 130) y = rect.bottom + scrollY + 12;
      pop.style.left = x + "px"; pop.style.top = y + "px";
      if (focusIt) $(".hl-sw", pop).focus();
    },
    hidePop: function () { pop.hidden = true; this.editing = null; },
    /* panel */
    renderPanel: function () {
      var groups = {}, order = [];
      this.list.forEach(function (h) { if (!groups[h.group]) { groups[h.group] = []; order.push(h.group); } groups[h.group].push(h); });
      $("#hl-empty").hidden = !!order.length; $("#hl-actions").hidden = !order.length;
      $("#hl-list").innerHTML = order.map(function (g) {
        var hs = groups[g], h = hs[0], el = book.querySelector('[data-pid="' + h.pid + '"]'), u = el && el.closest("section.unit");
        var where = u ? (u.dataset.label ? u.dataset.label + " · " : "") + u.dataset.title : "Not found in this version of the book";
        var text = hs.map(function (x) { return x.text; }).join(" … ");
        return '<li class="hl-item" data-hid="' + h.id + '"><p class="hl-where"><span class="hl-dot hl-dot--' + h.color + '" aria-hidden="true"></span>' + esc(where) + "</p>" +
          '<p class="hl-quote">' + esc(text) + "</p>" + (h.note ? '<p class="hl-note">Note: ' + esc(h.note) + "</p>" : "") +
          '<div class="hl-btns"><button type="button" class="mini-btn" data-act="go">Go to</button><button type="button" class="mini-btn" data-act="note">' + (h.note ? "Edit note" : "Add note") + "</button>" +
          ["1", "2", "3"].map(function (c) { return '<button type="button" class="mini-btn mini-btn--sw" data-act="color" data-color="' + c + '" aria-pressed="' + (h.color === c) + '"><span class="hl-dot hl-dot--' + c + '" aria-hidden="true"></span><span class="visually-hidden">' + ({ 1: "Lilac", 2: "Mint", 3: "Peach" })[c] + "</span></button>"; }).join("") +
          '<button type="button" class="mini-btn" data-act="del">Remove</button></div></li>';
      }).join("");
    },
    exportText: function () {
      var self = this, lines = ["Designing Trust in Self-Administered Colorectal Cancer Screening", "My highlights, exported " + new Date().toLocaleString(), ""], seen = {};
      this.list.forEach(function (h) {
        if (seen[h.group]) return; seen[h.group] = 1;
        var hs = self.list.filter(function (x) { return x.group === h.group; }), el = book.querySelector('[data-pid="' + h.pid + '"]'), u = el && el.closest("section.unit");
        var sec = el ? (function () { var s = null; $$("section.unit, h2[id]", u).forEach(function (x) { if (x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING || x === el) s = x; }); return s; })() : null;
        lines.push((u ? (u.dataset.label ? u.dataset.label + " · " : "") + u.dataset.title : "") );
        lines.push("“" + hs.map(function (x) { return x.text; }).join(" … ") + "”");
        if (h.note) lines.push("Note: " + h.note);
        if (sec) lines.push(linkFor("read/" + sec.id));
        lines.push("");
      });
      return lines.join("\n");
    }
  };
  function selectionInBook() {
    var sel = window.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0); if (!book.contains(r.commonAncestorContainer)) return null;
    if (!r.toString().trim()) return null; return r;
  }
  var selTimer;
  doc.addEventListener("selectionchange", function () {
    clearTimeout(selTimer);
    selTimer = setTimeout(function () {
      if (current !== "read") return;
      var r = selectionInBook();
      if (r) { HL.range = r.cloneRange(); HL.showPop(false); }
      else if (!pop.contains(doc.activeElement) && !HL.editing) { HL.range = null; HL.hidePop(); }
    }, 180);
  });
  pop.addEventListener("mousedown", function (e) { e.preventDefault(); });   // keep the selection while clicking the popover
  pop.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.color) { if (HL.editing) { HL.recolor(HL.editing, b.dataset.color); HL.hidePop(); } else HL.add(b.dataset.color); return; }
    if (b.id === "hlpop-del") { var id = HL.editing; HL.hidePop(); HL.remove(id); return; }
    if (b.id === "hlpop-note") {
      var target = HL.editing ? HL.group(HL.editing)[0] : (HL.add("1") || [])[0];
      HL.hidePop(); if (target) openNote(target.id, b);
    }
  });
  pop.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { HL.hidePop(); book.focus && book.focus(); }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { var bs = $$("button:not([hidden])", pop), i = bs.indexOf(doc.activeElement); if (i >= 0) { e.preventDefault(); bs[(i + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length].focus(); } }
  });
  book.addEventListener("click", function (e) {
    var m = e.target.closest("mark.hl"); if (!m || selectionInBook()) return;
    HL.range = null; HL.showPop(false, m.dataset.hid);
  });
  doc.addEventListener("mousedown", function (e) { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest("mark.hl")) { if (HL.editing) HL.hidePop(); } });
  $("#t-mark").addEventListener("mousedown", function (e) { e.preventDefault(); });
  $("#t-mark").addEventListener("click", function () {
    var r = selectionInBook(); if (r) HL.range = r.cloneRange();
    if (HL.range) HL.showPop(true); else announce("Select some text in the book first, then choose Highlight. With a keyboard, turn on caret browsing (F7) or use your screen reader’s selection keys.");
  });
  /* note editor */
  var noteDlg = $("#note"), noteFor = null;
  function openNote(id, opener) { noteFor = id; var g = HL.group(id); $("#note-quote").textContent = g.map(function (h) { return h.text; }).join(" … "); $("#note-text").value = g[0].note || ""; var back = opener && doc.contains(opener) && opener.offsetParent !== null ? opener : null;
    if (!back) { var mk = $('mark[data-hid="' + id + '"]', book); back = mk ? mk.closest("[data-pid]") : $("#t-hl"); if (back && !back.hasAttribute("tabindex")) back.setAttribute("tabindex", "-1"); }
    openDialog(noteDlg, back); setTimeout(function () { $("#note-text").focus(); }, 40); }
  $("#note-form").addEventListener("submit", function (e) { e.preventDefault(); if (noteFor) HL.setNote(noteFor, $("#note-text").value.trim()); announce("Note saved."); closeDialog(noteDlg); });
  /* panel */
  $("#t-hl").addEventListener("click", function () { HL.renderPanel(); openDialog($("#hlpanel"), $("#t-hl")); });
  $("#hl-list").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return; var id = b.closest(".hl-item").dataset.hid, act = b.dataset.act;
    if (act === "go") {
      $("#hlpanel")._opener = null; closeDialog($("#hlpanel"));
      var m = $('mark[data-hid="' + id + '"]', book);
      if (m) { m.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" }); m.classList.add("is-flash"); setTimeout(function () { m.classList.remove("is-flash"); }, 2400); var p = m.closest("[data-pid]"); p.setAttribute("tabindex", "-1"); p.focus({ preventScroll: true }); }
    } else if (act === "note") openNote(id, b);
    else if (act === "color") { HL.recolor(id, b.dataset.color); var nb = $('.hl-item[data-hid="' + id + '"] [data-color="' + b.dataset.color + '"]'); if (nb) nb.focus(); }
    else if (act === "del") { var li = b.closest(".hl-item"), next = li.nextElementSibling || li.previousElementSibling; HL.remove(id); var f = next && $('.hl-item[data-hid="' + next.dataset.hid + '"] button'); (f || $("#hlpanel .icon-btn")).focus(); }
  });
  $("#hl-export").addEventListener("click", function () {
    var blob = new Blob([HL.exportText()], { type: "text/plain;charset=utf-8" }), a = doc.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "designing-trust-highlights.txt"; doc.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    announce("Highlights exported as a text file.");
  });
  $("#hl-copy").addEventListener("click", async function () { var ok = await copyText(HL.exportText()); announce(ok ? "Highlights copied." : "Could not copy."); this.textContent = ok ? "Copied" : "Copy failed"; var b = this; setTimeout(function () { b.textContent = "Copy all"; }, 2000); });
  $("#hl-clear").addEventListener("click", function () {
    if (!confirm("Remove all highlights and notes from this device?")) return;
    HL.list.forEach(function (h) { HL.unpaint(h.id); }); HL.list = []; HL.save(); HL.renderPanel(); announce("All highlights removed."); $("#hlpanel .icon-btn").focus();
  });

  /* ================================================================ focus / reading ruler */
  var Focus = {
    on: false, cur: null,
    bind: function () {},
    set: function (v) {
      this.on = v; root.classList.toggle("focus-on", v); $("#t-focus").setAttribute("aria-pressed", String(v));
      if (!v && this.cur) { this.cur.classList.remove("is-focus"); var f = this.cur.closest(".figure"); if (f) f.classList.remove("is-focus"); this.cur = null; }
      if (v) this.update();
    },
    update: function () {
      if (!this.on) return;
      var line = window.innerHeight * 0.42, best = null, bd = 1e9;
      for (var i = 0; i < Read.paras.length; i++) {
        var r = Read.paras[i].getBoundingClientRect(); if (r.bottom < 0) continue; if (r.top > window.innerHeight) break;
        var d = r.top <= line && r.bottom >= line ? 0 : Math.min(Math.abs(r.top - line), Math.abs(r.bottom - line));
        if (d < bd) { bd = d; best = Read.paras[i]; }
      }
      if (best && best !== this.cur) {
        if (this.cur) { this.cur.classList.remove("is-focus"); var of = this.cur.closest(".figure"); if (of) of.classList.remove("is-focus"); }
        best.classList.add("is-focus"); var fg = best.closest(".figure"); if (fg) fg.classList.add("is-focus"); this.cur = best;
      }
    }
  };
  $("#t-focus").addEventListener("click", function () { Focus.set(!Focus.on); announce(Focus.on ? "Focus mode on. Everything except the paragraph you are reading is dimmed." : "Focus mode off."); });

  /* ================================================================ boot */
  async function boot() {
    await gate();
    $("#app").hidden = false;
    if (!S.setupDone) { views.home.hidden = true; await route(true); await runSetup(); }
    else await route(true);
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && location.hostname !== "localhost") {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }
  window.__gp = { S: S, HL: HL, TTS: TTS, Read: Read, Focus: Focus, openSettings: openSettings, finishSetup: finishSetup };
  boot();
})();
