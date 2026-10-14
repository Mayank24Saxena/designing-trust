/* Asset layer. Every piece of content (book HTML, JSON, images, EPUB) is read through getAsset().
   Today the build is plain and getAsset() simply fetches. When SITE_CONFIG.encrypted is true, each asset
   is stored as <path>.enc = 12-byte IV || AES-GCM ciphertext, with the key derived from the access code
   by PBKDF2-SHA256 (salt + iterations in config). The access code is checked by decrypting
   SITE_CONFIG.check in both modes, so the gate behaves identically before and after encryption.

   file:// cannot fetch(), so the build also writes <path>.js (or <path>.enc.js) wrappers that call
   __gpAsset(path, data, isBase64) — getAsset() falls back to injecting those script tags. */
(function () {
  "use strict";
  var CFG = window.SITE_CONFIG || {};
  var KEY_STORE = "gpbook1.key";
  var key = null;            // CryptoKey once unlocked
  var urlCache = {};         // path -> object URL / URL
  var inline = {};           // path -> {data, b64}
  var waiting = {};          // path -> [resolve]
  var isFile = location.protocol === "file:";

  function b64ToBytes(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function bytesToB64(u) { var s = ""; u = new Uint8Array(u); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }

  window.__gpAsset = function (path, data, b64) {
    inline[path] = { data: data, b64: !!b64 };
    (waiting[path] || []).forEach(function (r) { r(inline[path]); });
    delete waiting[path];
  };
  function loadWrapper(path) {
    if (inline[path]) return Promise.resolve(inline[path]);
    return new Promise(function (resolve, reject) {
      (waiting[path] = waiting[path] || []).push(resolve);
      var s = document.createElement("script");
      s.src = path + (CFG.encrypted ? ".enc.js" : ".js");
      s.onerror = function () { reject(new Error("Could not load " + path)); };
      document.head.appendChild(s);
    });
  }

  async function deriveKey(code) {
    var base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64ToBytes(CFG.salt), iterations: CFG.iterations, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }
  async function decrypt(k, bytes) {
    bytes = new Uint8Array(bytes);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, k, bytes.slice(12));
  }
  async function verify(k) {
    try { await decrypt(k, b64ToBytes(CFG.check)); return true; } catch (e) { return false; }
  }
  function remember(k) {
    return crypto.subtle.exportKey("raw", k).then(function (raw) {
      try { localStorage.setItem(KEY_STORE, bytesToB64(raw)); } catch (e) { /* not remembered on this device */ }
    });
  }

  /* Publish build: SITE_CONFIG.indexFile is an encrypted JSON index mapping each logical path either to
     its own file ({files: {path: "a/01.bin"}}) or to a slice of a pack ({packs: {path: [file, offset, length]}}).
     Every entry, and every slice, is IV || AES-GCM ciphertext on its own. Packs are fetched once and kept. */
  var indexP = null, packs = {};
  async function fetchBuf(file, prog) {
    var r = await fetch(file); if (!r.ok) throw new Error(file + " " + r.status);
    var total = Number(r.headers.get("content-length")) || 0;
    if (!prog || !r.body || !r.body.getReader) return r.arrayBuffer();
    var rd = r.body.getReader(), parts = [], got = 0;
    for (;;) { var c = await rd.read(); if (c.done) break; parts.push(c.value); got += c.value.length; try { prog(got, total); } catch (e) {} }
    var out = new Uint8Array(got), o = 0; for (var i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    return out.buffer;
  }
  function loadIndex() {
    if (!indexP) indexP = fetchBuf(CFG.indexFile).then(function (b) { return decrypt(key, b); })
      .then(function (p) { return JSON.parse(new TextDecoder().decode(p)); })
      .catch(function (e) { indexP = null; throw e; });
    return indexP;
  }
  async function packedBytes(path, prog) {
    var idx = await loadIndex(), p = idx.packs[path];
    if (p) {
      if (!packs[p[0]]) packs[p[0]] = fetchBuf(p[0]).catch(function (e) { delete packs[p[0]]; throw e; });
      var buf = await packs[p[0]]; return new Uint8Array(buf, p[1], p[2]);
    }
    var f = idx.files[path]; if (!f) throw new Error("Not in this edition: " + path);
    return fetchBuf(f, prog);
  }

  var inflight = {};
  var Vault = {
    get unlocked() { return !!key; },
    /* Try the key remembered on this device. */
    restore: async function () {
      var raw = null;
      try { raw = localStorage.getItem(KEY_STORE); } catch (e) {}
      if (!raw) return false;
      try {
        var k = await crypto.subtle.importKey("raw", b64ToBytes(raw), { name: "AES-GCM" }, true, ["decrypt"]);
        if (await verify(k)) { key = k; return true; }
      } catch (e) {}
      try { localStorage.removeItem(KEY_STORE); } catch (e) {}
      return false;
    },
    unlock: async function (code) {
      var k = await deriveKey(String(code || "").trim().toLowerCase());
      if (!(await verify(k))) return false;
      key = k; await remember(k); return true;
    },
    bypass: function () { key = "bypass"; },
    forget: function () { key = null; try { localStorage.removeItem(KEY_STORE); } catch (e) {} },

    /* getAsset(path, as): as = "text" | "json" | "blob" | "url" */
    getAsset: function (path, as, prog) {
      as = as || "text";
      if (as === "url" && urlCache[path]) return Promise.resolve(urlCache[path]);
      var k = path + "|" + as;
      if (as === "url" && inflight[k]) { if (prog) inflight[k].progs.push(prog); return inflight[k].p; }
      var progs = prog ? [prog] : [], fan = function (a, b) { progs.forEach(function (f) { f(a, b); }); };
      var p = Vault._get(path, as, fan);
      if (as === "url") { inflight[k] = { p: p, progs: progs }; p.then(function () { delete inflight[k]; }, function () { delete inflight[k]; }); }
      return p;
    },
    _get: async function (path, as, prog) {
      if (!CFG.encrypted) {
        if (as === "url") return (urlCache[path] = path);           // plain build: the file itself
        if (isFile && as !== "blob") {
          var w = await loadWrapper(path);
          return as === "json" ? JSON.parse(w.data) : w.data;
        }
        var r = await fetch(path);
        if (!r.ok) throw new Error(path + " " + r.status);
        return as === "json" ? r.json() : as === "blob" ? r.blob() : r.text();
      }
      if (!key || key === "bypass") throw new Error("locked");
      var bytes;
      if (CFG.indexFile) bytes = await packedBytes(path, prog);       // publish build: neutral file names + packs
      else if (isFile) { var ww = await loadWrapper(path); bytes = b64ToBytes(ww.data); }
      else { var rr = await fetch(path + ".enc"); if (!rr.ok) throw new Error(path + " " + rr.status); bytes = await rr.arrayBuffer(); }
      var plainBuf = await decrypt(key, bytes);
      if (as === "text") return new TextDecoder().decode(plainBuf);
      if (as === "json") return JSON.parse(new TextDecoder().decode(plainBuf));
      var type = /\.mp4$/.test(path) ? "video/mp4" : /\.vtt$/.test(path) ? "text/vtt" : /\.mp3$/.test(path) ? "audio/mpeg" : /\.webp$/.test(path) ? "image/webp" : /\.jpe?g$/.test(path) ? "image/jpeg" : /\.epub$/.test(path) ? "application/epub+zip" : "application/octet-stream";
      var blob = new Blob([plainBuf], { type: type });
      if (as === "blob") return blob;
      if (/\.(mp3|epub)$/.test(path)) return URL.createObjectURL(blob);   // large: caller revokes, not cached
      return (urlCache[path] = URL.createObjectURL(blob));
    }
  };
  window.Vault = Vault;
  window.getAsset = Vault.getAsset;
})();
