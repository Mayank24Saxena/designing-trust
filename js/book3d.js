/*!
 * book3d.js — a physical, readable 3D book for the "Designing Trust" digital edition.
 *
 * Requires three.js r160 classic build (global THREE). No modules, no other libraries,
 * nothing fetched from a CDN, so the page also runs from file:// (see "Textures" for the
 * one browser restriction that applies there).
 *
 *   var b = Book3D.create(containerEl, {
 *     count: 212, aspect: 420 / 297, startPage: 1, reducedMotion: false,
 *     getTexture: function (page, size) { return Promise.resolve(url); },  // size 's' | 'l'
 *     onChange: function (state) {}   // {page, spread:[l, r], closed, zoomed}
 *   });
 *   b.goTo(page); b.next(); b.prev(); b.state(); b.resetView();
 *   b.setTheme({paper:'#fff', ink:'#0D0D0D', dark:false}); b.setReducedMotion(bool); b.dispose();
 *
 * ---------------------------------------------------------------------------------------
 * The model (all in world units, 1 unit = one page width = 420 mm; the table is y = 0,
 * the spine runs along z at x = 0, the reader sits on +z looking at the book).
 *
 *   sheet 0            the front board (hard cover; rigid, never bends)
 *   sheet 1 … NLEAF    paper leaves. Leaf i carries page 2i-1 on its front (recto, right)
 *                      and page 2i on its back (verso, left). Page 1 is therefore a recto
 *                      on its own, followed by spreads 2|3, 4|5 … exactly like the print.
 *   back board         fixed on the table, never moves.
 *
 *   T = number of sheets lying on the left.   T = 0: closed, cover up.
 *   T = 1: cover open, [endpaper | p1].       T = k: [p 2(k-1) | p 2k-1].
 *
 * Every sheet rotates around ONE hinge line (x = 0, y = AXIS_Y = board + half the block),
 * which is what makes a closed book, an open book and the cover turn geometrically
 * consistent without special cases. Each leaf is described as a curve in the XY plane by
 * its tangent angle along its arc length s (0 at the spine, W at the fore-edge) and
 * integrated, so paper never stretches: bending is exact, only the shape changes.
 *
 *   resting right: the leaf runs from the hinge down (or up) into the stack, flattening
 *                  out after a short gutter curve, the way real pages fall into a binding.
 *   resting left:  the mirror image.
 *   turning:       the tangent angle is blended between the two rest shapes with a
 *                  per-point progress q(s, z) that leads towards the held edge/corner,
 *                  which yields a smooth C-shaped curl and a lifted corner.
 *
 * The two page blocks are solid extrusions of their cross-sections (rebuilt only when a
 * leaf lands); their top faces show the visible pages and the other faces use a paper-edge
 * texture whose lines follow the leaf curves. Only leaves that are actually moving exist as
 * separate deformable meshes (a small pool).
 *
 * Rendering is on demand: a frame is drawn only while something moves or a texture arrives.
 * ---------------------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  var THREE = root.THREE;
  var PI = Math.PI;

  /* ------------------------------------------------------------------ utilities */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }

  /* CSS-identical cubic-bezier easing (Newton–Raphson with bisection fallback). */
  function bezier(x1, y1, x2, y2) {
    var ax = 1 - 3 * x2 + 3 * x1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
    var ay = 1 - 3 * y2 + 3 * y1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
    function sx(t) { return ((ax * t + bx) * t + cx) * t; }
    function sy(t) { return ((ay * t + by) * t + cy) * t; }
    function dx(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x, i;
      for (i = 0; i < 8; i++) {
        var e = sx(t) - x, d = dx(t);
        if (Math.abs(e) < 1e-5) return sy(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      var lo = 0, hi = 1; t = x;
      for (i = 0; i < 30; i++) {
        var v = sx(t);
        if (Math.abs(v - x) < 1e-5) break;
        if (v < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return sy(t);
    };
  }
  var EASE_UI = bezier(0.2, 0.7, 0.2, 1);      /* DESIGN.md --ease: camera flights, settles */
  var EASE_TURN = bezier(0.36, 0.02, 0.16, 1);  /* a page is lifted, then laid down calmly  */
  var EASE_LINEAR = function (t) { return t; };

  /* Small deterministic PRNG so the generated textures are identical on every load. */
  function prng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function srgb(tex) {
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    else tex.encoding = THREE.sRGBEncoding; /* pre-r152 fallback */
    return tex;
  }

  /* --------------------------------------------------------------- image loading
   * Preferred path: fetch -> blob -> createImageBitmap (decoded off the main thread,
   * pre-flipped for WebGL). Fallback: <img>. From file:// Chrome treats every file as its
   * own origin, so an <img> loaded from a file URL taints WebGL; we detect that with a
   * 1×1 probe and report a clean error instead of letting WebGL throw. Hosts running from
   * file:// should hand getTexture() blob: or data: URLs (they always work).
   */
  function loadImage(url) {
    var canBitmap = typeof root.createImageBitmap === 'function' && typeof root.fetch === 'function';
    function viaImg() {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        if (/^https?:/i.test(url) && root.location && url.indexOf(root.location.origin) !== 0) img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = function () {
          try {
            var c = document.createElement('canvas'); c.width = c.height = 1;
            var g = c.getContext('2d'); g.drawImage(img, 0, 0, 1, 1); g.getImageData(0, 0, 1, 1);
          } catch (err) { reject(new Error('tainted image (cross-origin or file://): ' + url)); return; }
          resolve({ source: img, bitmap: false });
        };
        img.onerror = function () { reject(new Error('image failed: ' + url)); };
        img.src = url;
      });
    }
    var proto = '';
    try { proto = new URL(url, document.baseURI).protocol; } catch (e) { proto = ''; }
    if (!canBitmap || proto === 'file:') return viaImg();   /* fetch() cannot read file:// */
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (blob) {
      return createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
    }).then(function (bmp) { return { source: bmp, bitmap: true }; }, viaImg);
  }

  /* ================================================================== create() */

  function create(container, opts) {
    if (!THREE) throw new Error('Book3D: load three.min.js (global THREE) first.');
    if (!container) throw new Error('Book3D: container element required.');
    opts = opts || {};

    /* ---------------- dimensions */
    var COUNT = Math.max(1, opts.count | 0 || 212);
    var ASPECT = opts.aspect || 420 / 297;
    var W = 1, H = 1 / ASPECT;
    var MM = W / 420;
    var NLEAF = Math.ceil(COUNT / 2);          /* paper leaves */
    var TMAX = NLEAF + 1;                      /* front board + all leaves turned */
    var LEAF_T = 0.17 * MM;                    /* one leaf: ~150 gsm uncoated, 0.17 mm caliper */
    var P = NLEAF * LEAF_T;                    /* text block thickness (≈ 18 mm) */
    var BT = 2.5 * MM;                         /* board thickness */
    var OV = 3 * MM;                           /* board overhang (head, tail, fore-edge) */
    var AXIS_Y = BT + P / 2;                   /* the common hinge every sheet turns about */
    var EDGE_LINES = 64;
    var timeScale = 1;                         /* tests only: slows every animation */                       /* leaves per repeat of the edge texture */

    /* arc-length samples across a leaf (denser at the gutter where the paper curves) */
    var NS = 44, NZ = 10;
    var S = new Float32Array(NS + 1);
    for (var k = 0; k <= NS; k++) { var tk = k / NS; S[k] = W * (0.38 * tk + 0.62 * tk * tk); }
    function gutterShade(s) {
      /* soft occlusion into the binding + a whisper of fall-off at the fore-edge */
      return 1 - 0.26 * Math.exp(-s / (0.028 * W)) - 0.08 * Math.exp(-s / (0.11 * W)) - 0.025 * Math.exp(-(W - s) / (0.02 * W));
    }

    /* ---------------- options / state */
    var getTexture = typeof opts.getTexture === 'function' ? opts.getTexture : null;
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
    var reduced = !!opts.reducedMotion;
    var theme = { paper: '#ffffff', ink: '#0D0D0D', dark: false };
    var endpaperColor = opts.endpaper || '#EFEBF8';
    var coverTitle = opts.title || 'Designing Trust\nin Self-Administered\nColorectal Cancer Screening';
    var coverAuthor = opts.author || 'Mayank Saxena';

    function pageToT(p) {
      p = Math.round(+p || 0);
      if (p <= 0) return 0;
      return clamp(Math.floor(p / 2) + 1, 1, TMAX);
    }
    function spreadFor(t) {
      if (t <= 0) return [0, 0];
      var l = t === 1 ? 0 : 2 * (t - 1), r = 2 * t - 1;
      return [l > COUNT ? 0 : l, r > COUNT ? 0 : r];
    }
    function frontPage(i) { var p = 2 * i - 1; return p <= COUNT ? p : 0; }
    function backPage(i) { var p = 2 * i; return p <= COUNT ? p : 0; }

    var T = pageToT(opts.startPage == null ? 1 : opts.startPage);
    var pos = new Float32Array(TMAX);   /* animated position of each sheet: 0 right … 1 left */
    var goal = new Uint8Array(TMAX);    /* where each sheet is headed */
    for (var si = 0; si < TMAX; si++) { goal[si] = si < T ? 1 : 0; pos[si] = goal[si]; }
    var flights = [];                   /* moving sheets */
    var lastLaunch = { f: -1e9, b: -1e9 };
    var disposed = false;
    var zoomSide = null;                /* 'L' | 'R' while reading one page top-down */

    /* ---------------- renderer, scene, camera */
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    var canvas = renderer.domElement;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('tabindex', '-1');
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;';
    if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '0');
    var cs = root.getComputedStyle ? getComputedStyle(container) : null;
    if (cs && cs.position === 'static') container.style.position = 'relative';
    container.appendChild(canvas);
    var maxAniso = renderer.capabilities.getMaxAnisotropy ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(28, 1, 0.05, 30);

    /* lights: a broad soft sky + one key light from the upper left that casts the shadow */
    var hemi = new THREE.HemisphereLight(0xffffff, 0xb9b6c2, 1.0);
    scene.add(hemi);
    var key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(-1.25, 2.9, 1.55);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    var sc = key.shadow.camera;
    sc.left = -1.9; sc.right = 1.9; sc.top = 1.9; sc.bottom = -1.9; sc.near = 0.5; sc.far = 8;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.0025;
    scene.add(key); scene.add(key.target);
    var fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(1.6, 1.2, 2.2);
    scene.add(fill);

    var book = new THREE.Group();
    scene.add(book);

    /* ---------------- generated textures */
    var PLACEHOLDER = srgb(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1));
    PLACEHOLDER.needsUpdate = true;

    /* paper edge: fine leaf lines, a darker line at every signature (16 pages), fibre noise */
    function makeEdgeTexture() {
      var w = 64, h = EDGE_LINES * 4, c = document.createElement('canvas');
      c.width = w; c.height = h;
      var g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data, rnd = prng(7);
      var rowTone = [], leafTone = 0;
      for (var y = 0; y < h; y++) {
        var leaf = Math.floor(y / 4), inLeaf = y % 4;
        if (inLeaf === 0) leafTone = 244 + (rnd() - 0.5) * 12;   /* each leaf a touch different */
        var t = leafTone;
        if (inLeaf === 0) t = leafTone + 6;                        /* lit top of the leaf */
        if (inLeaf === 3) t = leafTone - 22 - rnd() * 10;          /* hairline gap to the next */
        if (leaf % 8 === 7 && inLeaf >= 2) t = 178 + rnd() * 12;   /* signature boundary */
        rowTone.push(clamp(t, 0, 255));
      }
      for (y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4, n = (rnd() - 0.5) * 7;
          var v = rowTone[y] + n;
          d[i] = v; d[i + 1] = v - 1; d[i + 2] = v - 3; d[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      var tex = srgb(new THREE.CanvasTexture(c));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = maxAniso;
      return tex;
    }

    /* the default cover: ink board, subtle grain, hinge groove, title + author in light sans */
    var coverCanvas = null;
    function drawCover() {
      var wPx = 2048, bw = W + OV, bh = H + 2 * OV, hPx = Math.round(wPx * bh / bw);
      var c = coverCanvas || document.createElement('canvas');
      c.width = wPx; c.height = hPx;
      var g = c.getContext('2d', { willReadFrequently: true }), mm = wPx / (bw / MM);
      g.fillStyle = '#121214'; g.fillRect(0, 0, wPx, hPx);
      /* low-frequency mottling of the board cloth */
      var lo = document.createElement('canvas'); lo.width = 64; lo.height = 46;
      var lg = lo.getContext('2d'), li = lg.createImageData(64, 46), rnd = prng(11);
      for (var i = 0; i < li.data.length; i += 4) { var v = 128 + (rnd() - 0.5) * 60; li.data[i] = li.data[i + 1] = li.data[i + 2] = v; li.data[i + 3] = 255; }
      lg.putImageData(li, 0, 0);
      g.globalAlpha = 0.05; g.imageSmoothingEnabled = true; g.drawImage(lo, 0, 0, wPx, hPx); g.globalAlpha = 1;
      /* fine grain */
      var img = g.getImageData(0, 0, wPx, hPx), d = img.data, r2 = prng(5);
      for (i = 0; i < d.length; i += 4) {
        var n = (r2() - 0.5) * 9;
        d[i] += n; d[i + 1] += n; d[i + 2] += n * 1.1;
      }
      g.putImageData(img, 0, 0);
      /* hinge groove ~9 mm from the spine */
      var gx = 9 * mm, gr = g.createLinearGradient(gx - 2.2 * mm, 0, gx + 2.2 * mm, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.42, 'rgba(0,0,0,0.55)');
      gr.addColorStop(0.62, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(gx - 2.2 * mm, 0, 4.4 * mm, hPx);
      /* type: light display weight, generous margins, no ornament */
      var fam = '"Inter Tight", "Inter", "Helvetica Neue", Arial, sans-serif';
      var left = 34 * mm, top = 34 * mm, maxW = 330 * mm, size = 19 * mm, lh = size * 1.1;
      g.fillStyle = '#EEECF3';
      g.textBaseline = 'alphabetic';
      g.font = '300 ' + size + 'px ' + fam;
      try { g.letterSpacing = (-0.012 * size) + 'px'; } catch (e) { /* older engines */ }
      /* explicit breaks ('\n') are kept; anything longer than maxW wraps */
      var lines = [];
      String(coverTitle).split('\n').forEach(function (para) {
        var words = para.split(' '), line = '';
        for (var wi = 0; wi < words.length; wi++) {
          var test = line ? line + ' ' + words[wi] : words[wi];
          if (g.measureText(test).width > maxW && line) { lines.push(line); line = words[wi]; } else line = test;
        }
        lines.push(line);
      });
      for (i = 0; i < lines.length; i++) g.fillText(lines[i], left, top + size * 0.78 + i * lh);
      g.font = '400 ' + (7.2 * mm) + 'px ' + fam;
      try { g.letterSpacing = '0px'; } catch (e2) { /* noop */ }
      g.fillStyle = 'rgba(238,236,243,0.78)';
      g.fillText(String(coverAuthor), left, hPx - 30 * mm);
      coverCanvas = c;
      return c;
    }
    function makeBackCover() {
      var c = document.createElement('canvas'); c.width = 512; c.height = 364;
      var g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#121214'; g.fillRect(0, 0, 512, 364);
      var img = g.getImageData(0, 0, 512, 364), d = img.data, rnd = prng(9);
      for (var i = 0; i < d.length; i += 4) { var n = (rnd() - 0.5) * 9; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      g.putImageData(img, 0, 0);
      return srgb(new THREE.CanvasTexture(c));
    }

    /* inside of a board: the cover cloth turned in around the edges, endpaper pasted down
       inset from head, tail and fore-edge (the spine side runs into the hinge) */
    function makeEndpaper(col) {
      var c = document.createElement('canvas'), wPx = 1024, bw = W + OV, bh = H + 2 * OV, hPx = Math.round(wPx * bh / bw);
      c.width = wPx; c.height = hPx;
      var g = c.getContext('2d'), mm = wPx / (bw / MM), m = OV / MM + 3.5;
      g.fillStyle = '#121214'; g.fillRect(0, 0, wPx, hPx);
      g.fillStyle = col; g.fillRect(0, m * mm, wPx - m * mm, hPx - 2 * m * mm);
      var t = srgb(new THREE.CanvasTexture(c)); t.anisotropy = maxAniso; return t;
    }
    var endTex = makeEndpaper(endpaperColor);
    var edgeTex = makeEdgeTexture();
    var coverTex = srgb(new THREE.CanvasTexture(drawCover()));
    coverTex.anisotropy = maxAniso;
    var backTex = makeBackCover();
    var ownCover = true;

    /* ---------------- materials */
    var paperColor = new THREE.Color(theme.paper);
    function pageMaterial(side) {
      return new THREE.MeshStandardMaterial({ map: PLACEHOLDER, color: 0xffffff, roughness: 0.86, metalness: 0, vertexColors: true, side: side || THREE.FrontSide });
    }
    var edgeMat = new THREE.MeshStandardMaterial({ map: edgeTex, color: 0xffffff, roughness: 0.95, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
    var boardEdgeMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.7, metalness: 0 });
    var coverMat = new THREE.MeshStandardMaterial({ map: coverTex, color: 0xffffff, roughness: 0.62, metalness: 0 });
    var backOuterMat = new THREE.MeshStandardMaterial({ map: backTex, color: 0xffffff, roughness: 0.62, metalness: 0 });
    var endMat = new THREE.MeshStandardMaterial({ map: endTex, color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true });
    var matR = pageMaterial(), matL = pageMaterial();

    /* ---------------- boards and spine */
    function boardGeometry(innerUp) {
      /* a box whose inner face carries the gutter shading as vertex colours */
      var g = new THREE.BoxGeometry(W + OV, BT, H + 2 * OV, 24, 1, 1);
      var p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3);
      for (var i = 0; i < p.count; i++) {
        var x = p.getX(i) + (W + OV) / 2, ny = n.getY(i);
        var inner = innerUp ? ny > 0.5 : ny < -0.5;
        var v = inner ? 1 - 0.18 * Math.exp(-x / 0.03) - 0.05 * Math.exp(-x / 0.12) : 1;
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    }
    /* BoxGeometry material order: +x, -x, +y, -y, +z, -z */
    var bm = boardEdgeMat;
    var backBoard = new THREE.Mesh(boardGeometry(true), [bm, bm, endMat, backOuterMat, bm, bm]);
    backBoard.position.set((W + OV) / 2, BT / 2, 0);
    backBoard.castShadow = backBoard.receiveShadow = true;
    book.add(backBoard);

    var coverPivot = new THREE.Group();
    coverPivot.position.set(0, AXIS_Y, 0);
    book.add(coverPivot);
    var frontBoard = new THREE.Mesh(boardGeometry(false), [bm, bm, coverMat, endMat, bm, bm]);
    frontBoard.position.set((W + OV) / 2, P / 2 + BT / 2 + 0.0002, 0);
    frontBoard.castShadow = frontBoard.receiveShadow = true;
    coverPivot.add(frontBoard);

    /* spine: the cloth between the boards (an annular sector around the hinge) and the
       rounded back of the text block (a sector filled with paper edge) */
    var spineMesh = new THREE.Mesh(new THREE.BufferGeometry(), boardEdgeMat);
    var spineFill = new THREE.Mesh(new THREE.BufferGeometry(), edgeMat);
    spineMesh.position.set(0, AXIS_Y, 0); spineFill.position.set(0, AXIS_Y, 0);
    spineMesh.castShadow = true; spineMesh.receiveShadow = true; spineFill.receiveShadow = true;
    spineMesh.frustumCulled = spineFill.frustumCulled = false;
    book.add(spineMesh); book.add(spineFill);
    var lastSpineTheta = -1;
    function buildSpine(theta) {
      if (Math.abs(theta - lastSpineTheta) < 1e-5) return;
      lastSpineTheta = theta;
      var a0 = PI / 2 + theta, a1 = 1.5 * PI, span = a1 - a0;
      var vis = span > 0.01;
      spineMesh.visible = spineFill.visible = vis;
      if (!vis) return;
      var N = 20, ri = P / 2, ro = P / 2 + BT, z0 = -(H / 2 + OV), z1 = H / 2 + OV, zf0 = -H / 2, zf1 = H / 2;
      var pos = [], nor = [], idx = [], i, a, c, s;
      /* outer cloth surface */
      for (i = 0; i <= N; i++) {
        a = a0 + span * i / N; c = Math.cos(a); s = Math.sin(a);
        pos.push(ro * c, ro * s, z0, ro * c, ro * s, z1); nor.push(c, s, 0, c, s, 0);
      }
      for (i = 0; i < N; i++) { var b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      /* head and tail rims of the cloth */
      var base = pos.length / 3;
      for (var e = 0; e < 2; e++) {
        var zz = e ? z1 : z0, nz = e ? 1 : -1, st = pos.length / 3;
        for (i = 0; i <= N; i++) {
          a = a0 + span * i / N; c = Math.cos(a); s = Math.sin(a);
          pos.push(ri * c, ri * s, zz, ro * c, ro * s, zz); nor.push(0, 0, nz, 0, 0, nz);
        }
        for (i = 0; i < N; i++) { var q = st + i * 2; if (e) idx.push(q, q + 1, q + 2, q + 2, q + 1, q + 3); else idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
      }
      void base;
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setIndex(idx);
      spineMesh.geometry.dispose(); spineMesh.geometry = g;
      /* rounded back of the block: two fans at head and tail, edge-textured */
      var fp = [], fn = [], fu = [], fc = [], fi = [];
      for (e = 0; e < 2; e++) {
        var z = e ? zf1 : zf0, nz2 = e ? 1 : -1, st2 = fp.length / 3;
        fp.push(0, 0, z); fn.push(0, 0, nz2); fu.push(0, (P / 2) / LEAF_T / EDGE_LINES); fc.push(1, 1, 1);
        for (i = 0; i <= N; i++) {
          a = a0 + span * i / N; c = Math.cos(a); s = Math.sin(a);
          fp.push(ri * c, ri * s, z); fn.push(0, 0, nz2);
          fu.push(ri * c * 30, (ri * s + P / 2) / LEAF_T / EDGE_LINES); fc.push(0.9, 0.9, 0.9);
        }
        for (i = 0; i < N; i++) fi.push(st2, st2 + 1 + i, st2 + 2 + i);
      }
      var fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
      fg.setAttribute('normal', new THREE.Float32BufferAttribute(fn, 3));
      fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
      fg.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
      fg.setIndex(fi);
      spineFill.geometry.dispose(); spineFill.geometry = fg;
    }

    /* ---------------- leaf shapes */

    /* tangent angle of a resting leaf at arc length s. `drop` is the height of the hinge
       above the leaf's flat level (negative when the leaf sits higher than the hinge),
       xc the length of the gutter curve; y(x) = h + drop·(1 − smoothstep(x/xc)). */
    function restAngle(s, drop, xc) {
      if (drop === 0 || s >= xc) return 0;
      var t = s / xc;
      return Math.atan(-drop * 6 * t * (1 - t) / xc);
    }
    function restProfile(level, o) {
      var h = BT + level * LEAF_T, drop = (AXIS_Y - h) * o;
      return { h: h, drop: drop, join: h + drop, xc: 0.05 * W + 3.4 * Math.abs(drop) };
    }

    /* Integrates one row of a leaf into xs/ys (arc-length samples 0…upto).
       Two shape families, both expressed as a per-point turn progress q(s) that blends the
       tangent angle from the right rest shape (q = 0) to the left rest shape (q = 1):
       - 'arc'  (automatic turns): q = p + bend·(s/W − ½). The outer edge leads while the
                page is lifted and trails as it falls (bend changes sign), like real paper.
       - 'roll' (dragging): a fold that travels from the fore-edge to the spine; q ramps
                0→1 over a length Lr around the fold, so the held corner stays low and the
                turned part lies over the page. Lr is generous at both ends (a soft lift and
                a soft landing) and tighter mid-turn.
       zn ∈ [-1, 1] is the row's position from head to tail; `tilt` makes the rows nearer
       the held corner run ahead, giving the diagonal fold of a page lifted by its corner. */
    function rollLen(pp) { return 0.52 * W + 0.95 * W * (1 - Math.sin(PI * clamp01(pp))); }
    function leafQ(sp, p, sh, zn) {
      var u = sp / W, amp;
      if (sh.rowMode === 'roll') {
        var pp = sh.dir > 0 ? p : 1 - p;
        amp = Math.sin(PI * clamp01(pp));
        var Lr = rollLen(pp);
        var a = W - pp * (W + Lr) - sh.tilt * zn * amp * 0.5 * W;
        var qq = clamp01((sp - a) / Lr);
        /* past the fold the turned part droops a little instead of floating like a plank */
        if (sp > a + Lr) qq += 0.035 * amp * clamp01((sp - a - Lr) / (0.5 * W));
        return sh.dir > 0 ? qq : 1 - qq;
      }
      amp = Math.sin(PI * clamp01(p));
      var prog = sh.dir > 0 ? p : 1 - p;
      var bend = sh.lead * (1 - 1.55 * prog) * sh.dir;
      return clamp01(p + amp * (bend * (u - 0.5) + sh.tilt * sh.dir * zn * u));
    }
    function leafRow(xs, ys, p, sh, zn, R, L, upto) {
      var n = upto == null ? NS : upto;
      var q0 = leafQ(0, p, sh, zn);
      var x = 0, y = lerp(R.join, L.join, q0);
      xs[0] = x; ys[0] = y;
      for (var k = 1; k <= n; k++) {
        var sm = 0.5 * (S[k] + S[k - 1]);
        var q = leafQ(sm, p, sh, zn);
        var a = (1 - q) * restAngle(sm, R.drop, R.xc) + q * (PI - restAngle(sm, L.drop, L.xc));
        var ds = S[k] - S[k - 1];
        x += Math.cos(a) * ds; y += Math.sin(a) * ds;
        xs[k] = x; ys[k] = y;
      }
    }
    var FLAT = { rowMode: 'arc', lead: 0, tilt: 0, dir: 1 };
    var rowX = new Float32Array(NS + 1), rowY = new Float32Array(NS + 1);

    /* ---------------- page blocks (solid stacks) */
    function blockGeometry(sign, level, o) {
      var R = restProfile(level, o), xs = rowX, ys = rowY;
      leafRow(xs, ys, 0, FLAT, 0, R, R);
      var pos = [], nor = [], uv = [], col = [], idx = [], groups = [[], []];
      var vlev = level / EDGE_LINES; /* v at the top surface in edge-texture repeats */
      function quad(g, a, b, c, d, na, nb, nc, nd, ua, ub, uc, ud, ca, cb, cc, cd) {
        var st = pos.length / 3;
        pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
        nor.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2], nd[0], nd[1], nd[2]);
        uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1], ud[0], ud[1]);
        col.push(ca, ca, ca, cb, cb, cb, cc, cc, cc, cd, cd, cd);
        /* wind so the geometric normal agrees with the supplied normal (a,b,c,d = quad loop) */
        var e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
        var cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
        var nx = na[0] + nc[0], ny = na[1] + nc[1], nz = na[2] + nc[2];
        if (cx * nx + cy * ny + cz * nz >= 0) groups[g].push(st, st + 1, st + 2, st, st + 2, st + 3);
        else groups[g].push(st, st + 2, st + 1, st, st + 3, st + 2);
      }
      var z0 = -H / 2, z1 = H / 2, i, n;
      /* top surface: the visible page */
      for (i = 0; i < NS; i++) {
        var a0 = Math.atan2(ys[i + 1] - ys[i], xs[i + 1] - xs[i]);
        var aPrev = i > 0 ? Math.atan2(ys[i] - ys[i - 1], xs[i] - xs[i - 1]) : a0;
        var aNext = i < NS - 1 ? Math.atan2(ys[i + 2] - ys[i + 1], xs[i + 2] - xs[i + 1]) : a0;
        var ta = 0.5 * (aPrev + a0), tb = 0.5 * (a0 + aNext);
        var nA = [-Math.sin(ta) * sign, Math.cos(ta), 0], nB = [-Math.sin(tb) * sign, Math.cos(tb), 0];
        var ua = sign > 0 ? S[i] / W : 1 - S[i] / W, ub = sign > 0 ? S[i + 1] / W : 1 - S[i + 1] / W;
        var ga = gutterShade(S[i]), gb = gutterShade(S[i + 1]);
        quad(0, [sign * xs[i], ys[i], z0], [sign * xs[i + 1], ys[i + 1], z0], [sign * xs[i + 1], ys[i + 1], z1], [sign * xs[i], ys[i], z1],
          nA, nB, nB, nA, [ua, 1], [ub, 1], [ub, 0], [ua, 0], ga, gb, gb, ga);
      }
      /* head (-z) and tail (+z): edge lines follow the leaf curves */
      for (var e = 0; e < 2; e++) {
        var z = e ? z1 : z0;
        n = [0, 0, e ? 1 : -1];
        for (i = 0; i < NS; i++) {
          var xa = sign * xs[i], xb = sign * xs[i + 1];
          quad(1, [xa, BT, z], [xb, BT, z], [xb, ys[i + 1], z], [xa, ys[i], z], n, n, n, n,
            [xa * 24, 0], [xb * 24, 0], [xb * 24, vlev], [xa * 24, vlev], 0.8, 0.8, 1, 1);
        }
      }
      /* fore-edge */
      var xe = sign * xs[NS], ye = ys[NS];
      n = [sign, 0, 0];
      quad(1, [xe, BT, z0], [xe, BT, z1], [xe, ye, z1], [xe, ye, z0], n, n, n, n,
        [z0 * 24, 0], [z1 * 24, 0], [z1 * 24, vlev], [z0 * 24, vlev], 0.8, 0.8, 1, 1);
      /* spine side (visible in the gutter above the open boards) */
      n = [-sign, 0, 0];
      quad(1, [0, BT, z0], [0, BT, z1], [0, ys[0], z1], [0, ys[0], z0], n, n, n, n,
        [z0 * 24, 0], [z1 * 24, 0], [z1 * 24, vlev], [z0 * 24, vlev], 0.7, 0.7, 0.85, 0.85);
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      var all = groups[0].concat(groups[1]);
      g.setIndex(all);
      g.addGroup(0, groups[0].length, 0);
      g.addGroup(groups[0].length, groups[1].length, 1);
      return g;
    }
    var blockR = new THREE.Mesh(new THREE.BufferGeometry(), [matR, edgeMat]);
    var blockL = new THREE.Mesh(new THREE.BufferGeometry(), [matL, edgeMat]);
    [blockR, blockL].forEach(function (m) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; book.add(m); });

    /* ---------------- moving leaves (pool of deformable double-sided sheets) */
    var GRID = (NS + 1) * (NZ + 1);
    function makeLeafMesh() {
      var posA = new THREE.BufferAttribute(new Float32Array(GRID * 3), 3);
      var norA = new THREE.BufferAttribute(new Float32Array(GRID * 3), 3);
      posA.setUsage(THREE.DynamicDrawUsage); norA.setUsage(THREE.DynamicDrawUsage);
      var col = new Float32Array(GRID * 3), uvF = new Float32Array(GRID * 2), uvB = new Float32Array(GRID * 2), idx = [];
      for (var r = 0; r <= NZ; r++) {
        for (var k = 0; k <= NS; k++) {
          var i = r * (NS + 1) + k, sh = gutterShade(S[k]);
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = sh;
          uvF[i * 2] = S[k] / W; uvF[i * 2 + 1] = 1 - r / NZ;
          uvB[i * 2] = 1 - S[k] / W; uvB[i * 2 + 1] = 1 - r / NZ;
        }
      }
      for (r = 0; r < NZ; r++) {
        for (k = 0; k < NS; k++) {
          var a = r * (NS + 1) + k, b = a + 1, c = a + NS + 1, d = c + 1;
          idx.push(a, c, b, b, c, d); /* normal +y when lying on the right */
        }
      }
      var colA = new THREE.BufferAttribute(col, 3);
      function geo(uv) {
        var g = new THREE.BufferGeometry();
        g.setAttribute('position', posA); g.setAttribute('normal', norA); g.setAttribute('color', colA);
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
        return g;
      }
      var gF = geo(uvF), gB = geo(uvB);
      var mF = pageMaterial(THREE.FrontSide), mB = pageMaterial(THREE.BackSide);
      mF.shadowSide = THREE.DoubleSide;
      /* every leaf converges on the hinge, so near the spine a moving leaf and the block
         under it meet; a small depth bias keeps the moving leaf on top */
      [mF, mB].forEach(function (m) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -6; m.transparent = true; });
      var front = new THREE.Mesh(gF, mF), back = new THREE.Mesh(gB, mB);
      front.castShadow = true; front.receiveShadow = true; back.receiveShadow = true;
      front.frustumCulled = back.frustumCulled = false;
      var grp = new THREE.Group(); grp.add(front); grp.add(back); grp.visible = false;
      book.add(grp);
      return { group: grp, front: front, back: back, gF: gF, gB: gB, posA: posA, norA: norA, busy: false };
    }
    var leafPool = [];
    function takeLeaf() {
      for (var i = 0; i < leafPool.length; i++) if (!leafPool[i].busy) { leafPool[i].busy = true; return leafPool[i]; }
      var m = makeLeafMesh(); m.busy = true; leafPool.push(m); return m;
    }
    function freeLeaf(m) { if (!m) return; m.busy = false; m.group.visible = false; }

    var tmpX = new Float32Array(NS + 1), tmpY = new Float32Array(NS + 1);
    function shapeLeaf(f, levels) {
      var m = f.mesh, arr = m.posA.array, o = pos[0];
      var R = restProfile(levels.r, o), L = restProfile(levels.l, o);
      for (var r = 0; r <= NZ; r++) {
        var zr = -H / 2 + H * r / NZ, zn = zr / (H / 2);
        leafRow(tmpX, tmpY, f.p, f, zn, R, L);
        for (var k = 0; k <= NS; k++) {
          var i = (r * (NS + 1) + k) * 3;
          arr[i] = tmpX[k]; arr[i + 1] = tmpY[k]; arr[i + 2] = zr;
        }
      }
      m.posA.needsUpdate = true;
      m.gF.computeVertexNormals(); /* writes into the shared normal attribute */
      m.norA.needsUpdate = true;
      m.group.visible = true;
      /* reduced motion: the quick turn also dissolves, so it reads as a crossfade */
      var op = reduced ? 1 - 0.85 * Math.sin(PI * clamp01(f.p)) : 1;
      m.front.material.opacity = m.back.material.opacity = op;
      m.front.material.depthWrite = m.back.material.depthWrite = op > 0.99;
      m.front.castShadow = !reduced;
    }

    /* ---------------- ground: transparent shadow catcher + soft contact shadow */
    var groundMat = new THREE.ShadowMaterial({ color: new THREE.Color(theme.ink), opacity: 0.14 });
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), groundMat);
    ground.rotation.x = -PI / 2; ground.position.y = -0.0004; ground.receiveShadow = true;
    scene.add(ground);
    function contactTexture() {
      var c = document.createElement('canvas'); c.width = 256; c.height = 192;
      var g = c.getContext('2d');
      g.shadowColor = 'rgba(0,0,0,1)'; g.shadowBlur = 26; g.shadowOffsetX = 1000;
      g.fillStyle = '#000'; g.fillRect(-1000 + 34, 34, 256 - 68, 192 - 68);
      var t = new THREE.CanvasTexture(c); return t;
    }
    var contactTex = contactTexture();
    function contactMesh() {
      var m = new THREE.Mesh(new THREE.PlaneGeometry((W + OV) * 1.34, (H + 2 * OV) * 1.46),
        new THREE.MeshBasicMaterial({ map: contactTex, color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
      m.rotation.x = -PI / 2; m.position.y = 0.0003; m.renderOrder = -1;
      book.add(m); return m;
    }
    var contactR = contactMesh(), contactL = contactMesh();
    contactR.position.x = (W + OV) / 2; contactL.position.x = -(W + OV) / 2;
    var contactBase = 0.3;

    /* =============================================================== textures (LRU) */
    var cache = new Map();     /* key -> entry */
    var queue = [];
    var loading = 0, MAX_LOADS = 4, LCAP = 6, SCAP = 30;
    var warnedTaint = false, imagesBlocked = false;
    function ckey(p, s) { return s + p; }
    function request(page, size, prio) {
      if (!getTexture || !page || imagesBlocked) return;
      var k2 = ckey(page, size), e = cache.get(k2);
      if (e) { e.used = now(); if (e.state === 'queued') e.prio = Math.min(e.prio, prio); return; }
      e = { key: k2, page: page, size: size, state: 'queued', prio: prio, used: now(), tex: null };
      cache.set(k2, e); queue.push(e); pump();
    }
    function pump() {
      if (disposed) return;
      queue.sort(function (a, b) { return a.prio - b.prio; });
      while (loading < MAX_LOADS && queue.length) {
        var e = queue.shift();
        if (e.state !== 'queued' || cache.get(e.key) !== e) continue;
        startLoad(e);
      }
    }
    function startLoad(e) {
      loading++; e.state = 'loading';
      Promise.resolve().then(function () { return getTexture(e.page, e.size); })
        .then(function (url) { if (!url) throw new Error('no url'); return loadImage(url); })
        .then(function (res) {
          if (disposed || cache.get(e.key) !== e) { if (res.bitmap && res.source.close) res.source.close(); return; }
          var tex = new THREE.Texture(res.source);
          srgb(tex);
          tex.flipY = !res.bitmap;
          tex.anisotropy = maxAniso;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = true;
          tex.needsUpdate = true;
          e.tex = tex; e.bitmap = res.bitmap; e.state = 'ready';
          mapsDirty = true; invalidate();
        })
        .catch(function (err) {
          e.state = 'error';
          if (!warnedTaint && /tainted/.test(String(err && err.message))) {
            warnedTaint = true; imagesBlocked = true; /* every page would fail the same way */
            if (root.console) console.warn('Book3D: page images cannot be used by WebGL from this origin (file:// or missing CORS). Pass blob:/data: URLs from getTexture().');
          }
        })
        .then(function () { loading--; pump(); });
    }
    function disposeEntry(e) {
      if (e.tex) { e.tex.dispose(); if (e.bitmap && e.tex.image && e.tex.image.close) e.tex.image.close(); }
      e.tex = null; e.state = 'evicted';
      cache.delete(e.key);
    }
    function best(page) {
      if (!page) return null;
      var l = cache.get(ckey(page, 'l'));
      if (l && l.state === 'ready') { l.used = now(); return l.tex; }
      var s = cache.get(ckey(page, 's'));
      if (s && s.state === 'ready') { s.used = now(); return s.tex; }
      return null;
    }
    /* decide what should be resident: large for the settled visible spread (+ the next one in
       the reading direction), small for ±3 spreads and any moving leaf; evict the rest (LRU). */
    var lastDir = 1;
    function housekeeping() {
      if (!getTexture) return;
      var wantL = {}, wantS = {}, i, sp, settled = flights.length === 0;
      sp = spreadFor(T);
      for (var d = -3; d <= 3; d++) {
        var s2 = spreadFor(clamp(T + d, 1, TMAX));
        if (s2[0]) { wantS[s2[0]] = 1; request(s2[0], 's', 10 + Math.abs(d) * 2); }
        if (s2[1]) { wantS[s2[1]] = 1; request(s2[1], 's', 10 + Math.abs(d) * 2 + 1); }
      }
      for (i = 0; i < flights.length; i++) {
        var f = flights[i]; if (f.i === 0) continue;
        var a = frontPage(f.i), b = backPage(f.i);
        if (a) { wantS[a] = 1; request(a, 's', 1); }
        if (b) { wantS[b] = 1; request(b, 's', 1); }
      }
      if (settled || !reduced) {
        if (sp[0]) { wantL[sp[0]] = 1; if (settled) request(sp[0], 'l', 3); }
        if (sp[1]) { wantL[sp[1]] = 1; if (settled) request(sp[1], 'l', 3); }
        if (settled) {
          var nx = spreadFor(clamp(T + lastDir, 1, TMAX));
          if (nx[0]) { wantL[nx[0]] = 1; request(nx[0], 'l', 30); }
          if (nx[1]) { wantL[nx[1]] = 1; request(nx[1], 'l', 30); }
        }
      }
      /* eviction */
      var ls = [], ss = [];
      cache.forEach(function (e) { (e.size === 'l' ? ls : ss).push(e); });
      function evict(list, want, cap) {
        list.sort(function (x, y) { return x.used - y.used; });
        var count = list.length;
        for (var j = 0; j < list.length && count > cap; j++) {
          var e = list[j];
          if (want[e.page]) continue;
          disposeEntry(e); count--;
        }
        /* never keep queued requests we no longer need */
        for (j = 0; j < list.length; j++) if (list[j].state === 'queued' && !want[list[j].page]) disposeEntry(list[j]);
      }
      evict(ls, wantL, LCAP); evict(ss, wantS, SCAP);
    }

    function setMap(mat, page) {
      var t = best(page) || PLACEHOLDER;
      if (mat.map !== t) { mat.map = t; }
      var c = t === PLACEHOLDER ? paperColor : WHITE;
      if (!mat.color.equals(c)) mat.color.copy(c);
    }
    var WHITE = new THREE.Color(0xffffff);

    /* ============================================================ stacks & flights */
    var nR = 0, nL = 0, topR = 0, topL = 0, stacksDirty = true, mapsDirty = true, lastO = -1;
    function countStacks() {
      nR = 0; nL = 0; topR = 0; topL = 0;
      var fl = {};
      for (var j = 0; j < flights.length; j++) fl[flights[j].i] = 1;
      for (var i = 1; i <= NLEAF; i++) {
        if (fl[i]) continue;
        if (pos[i] >= 0.5) { nL++; topL = i; } else { nR++; if (!topR) topR = i; }
      }
    }
    function leafLevels(i) {
      var r = nR, l = nL;
      for (var j = 0; j < flights.length; j++) {
        var k2 = flights[j].i; if (k2 === 0) continue;
        if (k2 >= i) r++;
        if (k2 <= i) l++;
      }
      return { r: r, l: l };
    }
    function flightOf(i) { for (var j = 0; j < flights.length; j++) if (flights[j].i === i) return flights[j]; return null; }

    function launch(i, to, t, multi) {
      var f = flightOf(i);
      var dist = Math.abs(to - pos[i]);
      var dur = (reduced ? 140 : (i === 0 ? 960 : (multi ? 600 : 880)) * (0.45 + 0.55 * dist)) * timeScale;
      if (f) {
        if (f.mode === 'drag') return;
        f.from = f.p; f.to = to; f.t0 = t; f.dur = dur; f.ease = reduced ? EASE_LINEAR : EASE_UI;
        if (f.rowMode !== 'roll') f.dir = to > f.p ? 1 : -1;
        return;
      }
      f = {
        i: i, p: pos[i], from: pos[i], to: to, t0: t, dur: dur, mode: 'auto', rowMode: 'arc',
        ease: reduced ? EASE_LINEAR : EASE_TURN, dir: to > pos[i] ? 1 : -1,
        lead: reduced ? 0 : (multi ? 0.32 : 0.42), tilt: reduced ? 0 : 0.07, mesh: null
      };
      if (i > 0) f.mesh = takeLeaf();
      flights.push(f);
      stacksDirty = true; mapsDirty = true; texDirty = true;
    }

    /* launch pending sheets in order, with a stagger; jump far-away ones instantly */
    var MAXVIS = 8;
    function schedule(t) {
      var fwd = [], bwd = [], i;
      for (i = 0; i < TMAX; i++) {
        var f = flightOf(i);
        if (f) { if (f.mode === 'auto' && f.to !== goal[i]) launch(i, goal[i], t, false); continue; }
        if (goal[i] === 1 && pos[i] < 1) fwd.push(i);
        else if (goal[i] === 0 && pos[i] > 0) bwd.push(i);
      }
      bwd.reverse();
      function run(list, toV, slot) {
        if (!list.length) return;
        var multi = list.length > 1 || flights.length > 0;
        if (list.length > MAXVIS) {
          var jump = list.length - MAXVIS;
          for (var j = 0; j < jump; j++) pos[list[j]] = toV;
          list = list.slice(jump); stacksDirty = true;
        }
        var stagger = (reduced ? 30 : 75) * timeScale;
        if (t - lastLaunch[slot] >= stagger || flights.length === 0) {
          launch(list[0], toV, t, multi || list.length > 1);
          lastLaunch[slot] = t;
        }
      }
      run(fwd, 1, 'f'); run(bwd, 0, 'b');
    }

    function stepFlights(t, dt) {
      var moving = false;
      for (var j = flights.length - 1; j >= 0; j--) {
        var f = flights[j];
        if (f.mode === 'drag') {
          var kk = reduced ? 1 : 1 - Math.exp(-dt / 45);
          var np = f.p + (f.pT - f.p) * kk;
          if (Math.abs(np - f.pT) < 1e-4) np = f.pT;
          if (np !== f.p) moving = true;
          f.p = np;
        } else {
          var u = (t - f.t0) / f.dur;
          if (u >= 1) {
            f.p = f.to; pos[f.i] = f.to;
            freeLeaf(f.mesh); flights.splice(j, 1);
            stacksDirty = true; mapsDirty = true; texDirty = true;
            moving = true;
            continue;
          }
          f.p = f.from + (f.to - f.from) * f.ease(u);
          moving = true;
        }
        pos[f.i] = f.p;
      }
      return moving;
    }

    /* =================================================================== camera */
    var DEF = { polar: 0.66, azim: 0.12, zoom: 1 };
    var view = { polar: DEF.polar, azim: DEF.azim, zoom: 1 };
    var LIM = { polarMin: 0.1, polarMax: 1.2, azimMax: 0.85, zoomMin: 0.45, zoomMax: 1.9 };
    var cam = null;            /* current {tx,ty,tz,polar,azim,dist} */
    var tween = null;          /* timed flight between camera states */
    var aspect = 1;

    /* exact fit: binary-search the distance at which the box (centred on the target) fits
       inside the viewport with the given margins, including perspective */
    var fitCam = new THREE.PerspectiveCamera(28, 1, 0.01, 50), fitV = new THREE.Vector3();
    function fitDistance(cx, cy, w, d, h, polar, azim, mx, my) {
      fitCam.fov = camera.fov; fitCam.aspect = aspect; fitCam.updateProjectionMatrix();
      var sp = Math.sin(polar), cp = Math.cos(polar), sa = Math.sin(azim), ca = Math.cos(azim);
      var lo = 0.2, hi = 30;
      for (var it = 0; it < 22; it++) {
        var dist = (lo + hi) / 2, ok = true;
        fitCam.position.set(cx + dist * sp * sa, cy + dist * cp, dist * sp * ca);
        fitCam.up.set(0, 1, 0); fitCam.lookAt(cx, cy, 0); fitCam.updateMatrixWorld(true);
        for (var c = 0; c < 8 && ok; c++) {
          fitV.set(cx + (c & 1 ? w : -w) / 2, (c & 2 ? h : 0), (c & 4 ? d : -d) / 2).project(fitCam);
          if (Math.abs(fitV.x) > mx || Math.abs(fitV.y) > my || fitV.z > 1) ok = false;
        }
        if (ok) hi = dist; else lo = dist;
      }
      return hi;
    }
    function goalCam() {
      var o = pos[0];
      if (zoomSide) {
        var sideX = zoomSide === 'R' ? W / 2 : -W / 2;
        var lv = zoomSide === 'R' ? nR : nL, ty = BT + lv * LEAF_T;
        return { tx: sideX, ty: ty, tz: 0, polar: 0.001, azim: 0, dist: fitDistance(sideX, ty, W, H, 0, 0.001, 0, 0.97, 0.95) * clamp(view.zoom, 0.6, 1.4) };
      }
      var w = lerp(W + OV, 2 * (W + OV), o), d = H + 2 * OV, tx = lerp((W + OV) / 2, 0, o);
      return {
        tx: tx, ty: AXIS_Y, tz: 0,
        polar: view.polar, azim: view.azim,
        dist: fitDistance(tx, AXIS_Y, w, d, 2 * BT + P, view.polar, view.azim, 0.9, 0.84) * view.zoom
      };
    }
    var CAMKEYS = ['tx', 'ty', 'tz', 'polar', 'azim', 'dist'];
    function flyCamera() {
      if (!cam) return;
      if (reduced) { tween = null; cam = goalCam(); return; }
      tween = { from: Object.assign({}, cam), t0: now(), dur: 560 * timeScale };
    }
    var spin = null;   /* orbit inertia after a flick: {vx, vy} in px/ms */
    function stepCamera(t, dt) {
      var moving = false, i, k2;
      if (spin && !reduced) {
        view.azim = clamp(view.azim - spin.vx * dt * 0.0035, -LIM.azimMax, LIM.azimMax);
        view.polar = clamp(view.polar - spin.vy * dt * 0.0035, LIM.polarMin, LIM.polarMax);
        var k = Math.exp(-dt / 260); spin.vx *= k; spin.vy *= k;
        if (Math.abs(spin.vx) + Math.abs(spin.vy) < 0.01) spin = null;
        moving = true;
      }
      var g = goalCam();
      if (!cam) { cam = g; return true; }
      if (tween) {
        var u = clamp01((t - tween.t0) / tween.dur), e = EASE_UI(u);
        for (i = 0; i < CAMKEYS.length; i++) { k2 = CAMKEYS[i]; cam[k2] = lerp(tween.from[k2], g[k2], e); }
        if (u >= 1) tween = null;
        moving = true;
      } else {
        var a = reduced ? 1 : 1 - Math.exp(-dt / 120);
        for (i = 0; i < CAMKEYS.length; i++) {
          k2 = CAMKEYS[i];
          var dv = g[k2] - cam[k2];
          if (Math.abs(dv) > 1e-5) { cam[k2] += dv * a; moving = true; } else cam[k2] = g[k2];
        }
      }
      return moving;
    }
    function applyCamera() {
      var sp = Math.sin(cam.polar), cp = Math.cos(cam.polar);
      camera.position.set(cam.tx + cam.dist * sp * Math.sin(cam.azim), cam.ty + cam.dist * cp, cam.tz + cam.dist * sp * Math.cos(cam.azim));
      camera.up.set(0, 1, 0);
      camera.lookAt(cam.tx, cam.ty, cam.tz);
    }

    /* ============================================================ frame scheduling */
    var raf = 0, lastFrame = 0, running = true, texDirty = true, frames = 0;
    function invalidate() {
      if (disposed || raf || !running) return;
      raf = root.requestAnimationFrame(frame);
    }
    function frame(t) {
      raf = 0;
      if (disposed) return;
      frames++;
      var dt = lastFrame ? clamp(t - lastFrame, 1, 64) : 16;
      lastFrame = t;
      schedule(t);
      var m1 = stepFlights(t, dt);
      var m2 = stepCamera(t, dt);
      updateScene();
      applyCamera();
      renderer.render(scene, camera);
      if (m1 || m2 || flights.length || tween || spin) invalidate();
      else lastFrame = 0;
    }

    function updateScene() {
      var o = pos[0];
      if (stacksDirty) countStacks();
      if (stacksDirty || Math.abs(o - lastO) > 1e-6) {
        blockR.visible = nR > 0; blockL.visible = nL > 0;
        if (nR > 0) { blockR.geometry.dispose(); blockR.geometry = blockGeometry(1, nR, o); }
        if (nL > 0) { blockL.geometry.dispose(); blockL.geometry = blockGeometry(-1, nL, o); }
        lastO = o; stacksDirty = false;
      }
      coverPivot.rotation.z = PI * o;
      buildSpine(PI * o);
      contactL.material.opacity = contactBase * clamp01((o - 0.5) * 2);
      contactR.material.opacity = contactBase;
      for (var j = 0; j < flights.length; j++) {
        var f = flights[j];
        if (f.mesh) shapeLeaf(f, leafLevels(f.i));
      }
      if (texDirty) { texDirty = false; housekeeping(); }
      /* page images on every visible surface (cheap; assigns only on change) */
      setMap(matR, topR ? frontPage(topR) : 0);
      setMap(matL, topL ? backPage(topL) : 0);
      for (j = 0; j < flights.length; j++) {
        f = flights[j];
        if (!f.mesh) continue;
        setMap(f.mesh.front.material, frontPage(f.i));
        setMap(f.mesh.back.material, backPage(f.i));
      }
      mapsDirty = false;
    }

    /* =========================================================== state & commands */
    var lastEmit = '';
    function getState() {
      var sp = spreadFor(T);
      return { page: T === 0 ? 0 : (sp[1] || sp[0]), spread: sp, closed: T === 0, zoomed: !!zoomSide };
    }
    function emit() {
      var s = getState(), sig = JSON.stringify(s);
      if (sig === lastEmit) return;
      lastEmit = sig;
      if (onChange) { try { onChange(s); } catch (e) { if (root.console) console.error(e); } }
    }
    function setT(nt) {
      nt = clamp(nt, 0, TMAX);
      if (nt === T) return false;
      lastDir = nt > T ? 1 : -1;
      T = nt;
      for (var i = 0; i < TMAX; i++) goal[i] = i < T ? 1 : 0;
      texDirty = true;
      emit(); invalidate();
      return true;
    }
    function isDragging() { for (var j = 0; j < flights.length; j++) if (flights[j].mode === 'drag') return true; return false; }
    function next() { if (!isDragging()) setT(T + 1); }
    function prev() { if (!isDragging()) setT(T - 1); }
    function goTo(p) { if (!isDragging()) setT(pageToT(p)); }
    function setZoom(side) {
      if (side === zoomSide) return;
      zoomSide = side;
      if (side) view.zoom = 1;
      flyCamera(); emit(); invalidate();
    }
    function resetView() {
      view.polar = DEF.polar; view.azim = DEF.azim; view.zoom = DEF.zoom;
      zoomSide = null; flyCamera(); emit(); invalidate();
    }

    /* =============================================================== interaction */
    var raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), hitPt = new THREE.Vector3();
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    function rayToPlane(cx, cy, y) {
      var r = canvas.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      plane.constant = -y;
      return raycaster.ray.intersectPlane(plane, hitPt) ? hitPt.clone() : null;
    }
    /* which page (if any) is under the pointer: {side:'L'|'R', u: 0 spine … 1 outer edge} */
    function hitPage(cx, cy) {
      var o = pos[0];
      var y = o < 0.5 ? 2 * BT + P : AXIS_Y;
      var p = rayToPlane(cx, cy, y);
      if (!p) return null;
      if (Math.abs(p.z) > H / 2 + OV + 0.02) return null;
      if (p.x >= 0 && p.x <= W + OV + 0.02) return { side: 'R', u: p.x / W, x: p.x, z: p.z };
      if (p.x < 0 && p.x >= -(W + OV + 0.02) && o > 0.5) return { side: 'L', u: -p.x / W, x: p.x, z: p.z };
      return null;
    }

    var pointers = new Map();
    var drag = null, lastTap = null;
    function grabbable(side) {
      var i = side === 'R' ? T : T - 1;
      if (i < 0 || i >= TMAX) return -1;
      var f = flightOf(i);
      if (f) return -1;
      if (side === 'R' && pos[i] !== 0) return -1;
      if (side === 'L' && pos[i] !== 1) return -1;
      return i;
    }
    /* x of the held point (arc length sg on row zn) for progress p — used to invert pointer → p */
    function heldX(f, p, levels) {
      if (f.i === 0) return f.sg * Math.cos(PI * p);
      var o = pos[0], R = restProfile(levels.r, o), L = restProfile(levels.l, o);
      var kk = 0; while (kk < NS && S[kk] < f.sg) kk++;
      leafRow(tmpX, tmpY, p, f, f.zn, R, L, kk);
      return tmpX[kk];
    }
    function solveP(f, x) {
      var levels = leafLevels(f.i), lo = 0, hi = 1;
      if (x >= heldX(f, 0, levels)) return 0;
      if (x <= heldX(f, 1, levels)) return 1;
      for (var it = 0; it < 18; it++) {
        var mid = (lo + hi) / 2;
        if (heldX(f, mid, levels) > x) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }
    function startPageDrag(d) {
      var i = grabbable(d.hit.side);
      if (i < 0) return false;
      var side = d.hit.side, zn = clamp(d.hit.z / (H / 2), -1, 1);
      var f = {
        i: i, p: pos[i], pT: pos[i], mode: 'drag', dir: side === 'R' ? 1 : -1,
        lead: 0, tilt: reduced ? 0 : 0.8 * zn, zn: zn, rowMode: 'roll',
        sg: clamp(Math.abs(d.hit.x), 0.3 * W, W), samples: [], mesh: null, ease: EASE_UI
      };
      if (i > 0) f.mesh = takeLeaf();
      flights.push(f);
      stacksDirty = true; mapsDirty = true;
      d.kind = 'page'; d.flight = f; d.planeY = (i === 0 && side === 'R') ? 2 * BT + P : AXIS_Y;
      f.samples.push({ t: d.t0, p: f.p }); /* the press itself anchors the flick velocity */
      return true;
    }
    function updatePageDrag(d, cx, cy) {
      var f = d.flight, p = rayToPlane(cx, cy, d.planeY);
      if (!p) return;
      f.pT = solveP(f, p.x);
      var t = now();
      f.samples.push({ t: t, p: f.pT });
      while (f.samples.length > 2 && t - f.samples[0].t > 120) f.samples.shift();
      invalidate();
    }
    function releasePageDrag(d, cancel) {
      var f = d.flight; if (!f) return;
      var s = f.samples, v = 0;
      if (s.length >= 2) { var a = s[0], b = s[s.length - 1]; v = (b.p - a.p) / (Math.max(16, b.t - a.t) / 1000); }
      if (now() - (s.length ? s[s.length - 1].t : 0) > 140) v = 0; /* paused before release: no flick */
      var startPos = f.dir > 0 ? 0 : 1, endPos = 1 - startPos, prog = Math.abs(f.pT - startPos);
      var dv = v * f.dir, complete;
      if (cancel) complete = false;
      else if (dv > 1.1) complete = true;
      else if (dv < -1.1) complete = false;
      else complete = prog > 0.5;
      var to = complete ? endPos : startPos;
      f.mode = 'auto'; f.from = f.p; f.to = to; f.t0 = now();
      f.dur = (reduced ? 140 : 170 + 480 * Math.abs(to - f.p)) * timeScale;
      f.ease = reduced ? EASE_LINEAR : EASE_UI;
      if (complete) setT(f.dir > 0 ? f.i + 1 : f.i);
      d.flight = null;
      invalidate();
    }

    function localXY(e) { return { x: e.clientX, y: e.clientY }; }
    function pinchInfo() {
      var a = [], it = pointers.values(), r;
      while (!(r = it.next()).done) a.push(r.value);
      var dx = a[1].x - a[0].x, dy = a[1].y - a[0].y;
      return { d: Math.max(1, Math.hypot(dx, dy)), mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2 };
    }
    function onPointerDown(e) {
      if (disposed) return;
      if (e.pointerType === 'mouse' && e.button > 2) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      var pt = localXY(e);
      pointers.set(e.pointerId, pt);
      if (pointers.size === 2) {
        if (drag && drag.kind === 'page') releasePageDrag(drag, true);
        var pi = pinchInfo();
        drag = { kind: 'pinch', d0: pi.d, zoom0: view.zoom, mx: pi.mx, my: pi.my };
        return;
      }
      if (pointers.size > 2) return;
      var orbitBtn = e.pointerType === 'mouse' && (e.button === 1 || e.button === 2);
      var hit = orbitBtn ? null : hitPage(pt.x, pt.y);
      spin = null; setCursor('orbiting');
      drag = { kind: 'pendingOrbit', id: e.pointerId, t0: now(), x0: pt.x, y0: pt.y, lx: pt.x, ly: pt.y, hit: hit, moved: false, touch: e.pointerType !== 'mouse' };
      /* no preventDefault: a click focuses the (tabindex -1) canvas without a focus ring,
         and key events bubble to the container's handler */
    }
    var curCursor = '';
    function setCursor(c) { if (c !== curCursor) { curCursor = c; canvas.dataset.cursor = c; } }
    function hover(cx, cy) {
      if (drag) return;
      var h = hitPage(cx, cy);
      setCursor(h ? (h.side === 'R' ? (T >= TMAX ? 'orbit' : 'next') : 'prev') : 'orbit');
    }
    function onPointerMove(e) {
      if (!drag && e.pointerType === 'mouse') { hover(e.clientX, e.clientY); return; }
      if (!pointers.has(e.pointerId) || !drag) return;
      var pt = localXY(e);
      pointers.set(e.pointerId, pt);
      if (drag.kind === 'pinch') {
        if (pointers.size < 2) return;
        var pi = pinchInfo();
        if (zoomSide) { view.zoom = clamp(drag.zoom0 * drag.d0 / pi.d, 0.6, 1.4); }
        else {
          view.zoom = clamp(drag.zoom0 * drag.d0 / pi.d, LIM.zoomMin, LIM.zoomMax);
          view.azim = clamp(view.azim - (pi.mx - drag.mx) * 0.005, -LIM.azimMax, LIM.azimMax);
          view.polar = clamp(view.polar - (pi.my - drag.my) * 0.005, LIM.polarMin, LIM.polarMax);
        }
        drag.mx = pi.mx; drag.my = pi.my;
        tween = null; invalidate();
        return;
      }
      if (e.pointerId !== drag.id) return;
      var dx = pt.x - drag.x0, dy = pt.y - drag.y0, thr = drag.touch ? 9 : 4;
      if (!drag.moved && dx * dx + dy * dy > thr * thr) {
        drag.moved = true;
        if (drag.kind === 'pendingPage') { if (!startPageDrag(drag)) drag.kind = 'orbit'; }
        else if (drag.kind === 'pendingOrbit') drag.kind = 'orbit';
      }
      if (drag.kind === 'page') updatePageDrag(drag, pt.x, pt.y);
      else if (drag.kind === 'orbit' && !zoomSide) {
        view.azim = clamp(view.azim - (pt.x - drag.lx) * 0.0035, -LIM.azimMax, LIM.azimMax);
        view.polar = clamp(view.polar - (pt.y - drag.ly) * 0.0035, LIM.polarMin, LIM.polarMax);
        var tn = now(), dtm = Math.max(1, tn - (drag.lt || drag.t0));
        drag.vx = 0.6 * (drag.vx || 0) + 0.4 * (pt.x - drag.lx) / dtm; drag.vy = 0.6 * (drag.vy || 0) + 0.4 * (pt.y - drag.ly) / dtm; drag.lt = tn;
        tween = null; invalidate();
      }
      drag.lx = pt.x; drag.ly = pt.y;
    }
    function onPointerUp(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (!drag) return;
      if (drag.kind === 'pinch') { if (pointers.size < 2) drag = null; return; }
      if (e.pointerId !== drag.id) return;
      var d = drag; drag = null;
      hover(e.clientX, e.clientY);
      if (d.kind === 'page') { releasePageDrag(d, e.type === 'pointercancel'); return; }
      if (d.kind === 'orbit' && d.moved && !zoomSide && now() - (d.lt || 0) < 60 && Math.hypot(d.vx || 0, d.vy || 0) > 0.15) { spin = { vx: d.vx, vy: d.vy }; invalidate(); }
      if (d.moved || e.type === 'pointercancel') return;
      onTap(d.hit, d.x0, d.y0);
    }
    function onTap(hit, x, y) {
      var t = now();
      if (!hit) {
        if (lastTap && !lastTap.hit && t - lastTap.t < 330 && Math.hypot(x - lastTap.x, y - lastTap.y) < 26) { if (zoomSide) setZoom(null); lastTap = null; }
        else lastTap = { t: t, x: x, y: y, hit: null };
        return;
      }
      /* a click anywhere on a page turns it: right page forward, left page back */
      lastTap = null;
      if (hit.side === 'R') next(); else prev();
    }
    function onWheel(e) {
      if (disposed) return;
      e.preventDefault();
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      var f = Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0012));
      view.zoom = zoomSide ? clamp(view.zoom * f, 0.6, 1.4) : clamp(view.zoom * f, LIM.zoomMin, LIM.zoomMax);
      tween = null; invalidate();
    }
    function onKey(e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      var handled = true;
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': next(); break;
        case 'ArrowLeft': case 'PageUp': prev(); break;
        case 'Home': goTo(1); break;
        case 'End': goTo(COUNT); break;
        case 'Escape': if (zoomSide) setZoom(null); else handled = false; break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    }
    function onContext(e) { e.preventDefault(); }
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', function () { if (!drag) setCursor(''); });
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('lostpointercapture', function (e) { if (pointers.has(e.pointerId)) onPointerUp({ pointerId: e.pointerId, type: 'pointercancel' }); });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('dblclick', function (e) { e.preventDefault(); });
    container.addEventListener('keydown', onKey);

    /* ============================================================ size & visibility */
    function resize() {
      var w = container.clientWidth || 1, h = container.clientHeight || 1;
      renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      aspect = w / h; camera.aspect = aspect; camera.updateProjectionMatrix();
      if (cam && !tween) cam = goalCam();
      invalidate();
    }
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(container); else root.addEventListener('resize', resize);
    var inView = true;
    var io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (en) {
      inView = en[en.length - 1].isIntersecting; updateRunning();
    }) : null;
    if (io) io.observe(container);
    function updateRunning() {
      var was = running;
      running = inView && !document.hidden;
      if (running && !was) { lastFrame = 0; invalidate(); }
      if (!running && raf) { root.cancelAnimationFrame(raf); raf = 0; }
    }
    document.addEventListener('visibilitychange', updateRunning);

    /* the cover typeface may still be loading: redraw once it is ready */
    if (document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load('300 80px "Inter Tight"'), document.fonts.load('400 30px "Inter Tight"')]).then(function () {
        if (disposed || !ownCover) return;
        drawCover(); coverTex.needsUpdate = true; invalidate();
      }, function () { /* fall back silently */ });
    }
    if (opts.coverTexture) setCoverTexture(opts.coverTexture);
    function setCoverTexture(src) {
      function useTex(t) { srgb(t); t.anisotropy = maxAniso; if (ownCover) coverTex.dispose(); ownCover = false; coverTex = t; coverMat.map = t; coverMat.needsUpdate = true; invalidate(); }
      if (src && src.isTexture) useTex(src);
      else if (src && (src.tagName === 'CANVAS' || src.tagName === 'IMG')) useTex(new THREE.CanvasTexture(src));
      else if (typeof src === 'string') loadImage(src).then(function (res) { var t = new THREE.Texture(res.source); t.flipY = !res.bitmap; t.needsUpdate = true; useTex(t); }, function () { /* keep default */ });
    }

    /* ============================================================ theme & motion */
    function setTheme(t) {
      t = t || {};
      if (t.paper) theme.paper = t.paper;
      if (t.ink) theme.ink = t.ink;
      if (typeof t.dark === 'boolean') theme.dark = t.dark;
      paperColor.set(theme.paper);
      var dk = theme.dark;
      groundMat.color.set(dk ? '#000000' : theme.ink);
      groundMat.opacity = dk ? 0.42 : 0.15;
      contactBase = dk ? 0.62 : 0.3;
      hemi.intensity = dk ? 1.3 : 1.62;
      hemi.groundColor.set(dk ? '#77747f' : '#d4d1da');
      key.intensity = dk ? 1.05 : 1.3;
      fill.intensity = dk ? 0.22 : 0.3;
      edgeMat.color.set(dk ? '#d9d7dd' : '#ffffff');
      boardEdgeMat.color.set(dk ? '#2a2930' : '#151517');   /* lets the book separate from a dark page */
      mapsDirty = true; invalidate();
    }
    function setReducedMotion(v) { reduced = !!v; if (reduced) { tween = null; } invalidate(); }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) root.cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else root.removeEventListener('resize', resize);
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', updateRunning);
      container.removeEventListener('keydown', onKey);
      cache.forEach(function (e) { disposeEntry(e); });
      scene.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.dispose(); });
      });
      [edgeTex, coverTex, backTex, contactTex, endTex, PLACEHOLDER].forEach(function (t) { t.dispose(); });
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }

    /* ============================================================ boot */
    setTheme(opts.theme || {});
    resize();
    housekeeping();
    Promise.resolve().then(emit);
    invalidate();

    var api = {
      goTo: goTo, next: next, prev: prev, state: getState, resetView: resetView,
      setTheme: setTheme, setReducedMotion: setReducedMotion, dispose: dispose,
      setCoverTexture: setCoverTexture,
      zoomTo: function (side) { setZoom(side === 'L' || side === 'R' ? side : null); },
      /* internal hooks for automated tests: world → client px, and idle detection */
      _debug: {
        project: function (x, y, z) {
          var v = new THREE.Vector3(x, y, z).project(camera), r = canvas.getBoundingClientRect();
          return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
        },
        setTimeScale: function (k) { timeScale = k > 0 ? k : 1; },
        frames: function () { return frames; },
        setView: function (polar, azim, zoom) { view.polar = polar; view.azim = azim; view.zoom = zoom; flyCamera(); invalidate(); },
        cache: function () {
          var out = { l: 0, s: 0, ready: 0, loading: loading, gpu: renderer.info.memory.textures };
          cache.forEach(function (e) { out[e.size]++; if (e.state === 'ready') out.ready++; });
          return out;
        },
        idle: function () { return !raf && flights.length === 0 && !tween; },
        dims: { W: W, H: H, AXIS_Y: AXIS_Y, BT: BT, P: P },
        renderer: renderer
      }
    };
    return api;
  }

  root.Book3D = { create: create, version: '1.0.0' };
})(typeof window !== 'undefined' ? window : this);
