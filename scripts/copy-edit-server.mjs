// Copy-edit server — serve the Impact Report with in-browser editable text,
// writing edits back into the source HTML as exact-string replacements.
//
// Usage:  node scripts/copy-edit-server.mjs [port]
//
// Design: the browser never round-trips the whole DOM (that would re-serialize
// and wreck the hand-written file). Instead the injected editor records each
// text block's original innerHTML and, on Save, POSTs {orig, next} pairs in
// document order. We replace each `orig` exactly once in the file, advancing a
// cursor so repeated strings resolve in order. If an `orig` can't be found
// (page JS mutated it, or entity mismatch beyond our variants), the edit is
// rejected, logged to copy-edit-failures.json, and the file is left untouched.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve, extname, normalize, join } from 'node:path';
import { tmpdir } from 'node:os';

const PORT = Number(process.argv[2] || 4747);
// One page, served from the repo root — no build step, no dist.
//   node scripts/copy-edit-server.mjs 4747
const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = resolve(ROOT, 'index.html');
const FAIL_LOG = resolve(import.meta.dirname, '..', 'copy-edit-failures.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.mp4': 'video/mp4', '.avif': 'image/avif',
};

// innerHTML serialization turns these entities into literal chars; when an
// exact match fails, retry with chars re-encoded (and nbsp decoded).
const CHAR_TO_ENTITY = [['×', '&times;'], ['→', '&rarr;'], ['\u2002', '&ensp;'], ['\u2009', '&thinsp;']];

function candidates(orig) {
  const reEncoded = CHAR_TO_ENTITY.reduce((s, [ch, ent]) => s.split(ch).join(ent), orig);
  const nbspLiteral = orig.split('&nbsp;').join('\u00A0');
  return [...new Set([orig, reEncoded, nbspLiteral])];
}

function applyEdits(edits) {
  let file = readFileSync(SOURCE, 'utf8');
  let cursor = 0;
  const results = [];
  for (const { orig, next } of edits) {
    let applied = false;
    // short strings are too ambiguous to place safely (a stray "1.0" once
    // rewrote the viewport meta) — the client sends outerHTML for those,
    // which carries the tag + attributes as matching context
    if (orig.length < 15) {
      results.push({ orig: orig.slice(0, 80), applied: false });
      appendFileSync(FAIL_LOG, JSON.stringify({ ts: new Date().toISOString(), orig, next, reason: 'too-short-to-match-safely' }) + '\n');
      continue;
    }
    for (const cand of candidates(orig)) {
      let at = file.indexOf(cand, cursor);
      if (at === -1) at = file.indexOf(cand); // fallback: search from top
      if (at !== -1) {
        file = file.slice(0, at) + next + file.slice(at + cand.length);
        cursor = at + next.length;
        applied = true;
        break;
      }
    }
    results.push({ orig: orig.slice(0, 80), applied });
    if (!applied) {
      appendFileSync(FAIL_LOG, JSON.stringify({ ts: new Date().toISOString(), orig, next }) + '\n');
    }
  }
  const failed = results.filter(r => !r.applied).length;
  if (results.length > failed) writeFileSync(SOURCE, file);
  return { applied: results.length - failed, failed, results };
}

// ── photo swap: drop an image file onto any photo in the page ──
// Saves the file into the report's img/ dir (sips-resized to ≤1800px, jpeg),
// then swaps every reference to the old path in the source HTML.
function swapImage({ oldUrl, name, dataB64, occurrence = 0, total = 1 }) {
  if (!oldUrl || !dataB64) throw new Error('oldUrl and dataB64 required');
  if (dataB64.length > 45_000_000) throw new Error('image too large (>~32MB)');
  const html = readFileSync(SOURCE, 'utf8');
  // find every occurrence of the old path; the client tells us which ONE
  // (DOM order) the drop landed on — only that instance is rewritten
  const positions = [];
  for (let at = html.indexOf(oldUrl); at !== -1; at = html.indexOf(oldUrl, at + 1)) positions.push(at);
  if (!positions.length) throw new Error(`old path not found in source: ${oldUrl}`);
  if (positions.length !== total) throw new Error(
    `ref count mismatch (file has ${positions.length}, page sees ${total}) — not guessing; ask the agent`);
  const at = positions[occurrence];
  if (at === undefined) throw new Error(`occurrence ${occurrence} out of range`);
  const slug = (name || 'photo').toLowerCase().replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'photo';
  let file = `img/${slug}.jpg`, n = 2;
  while (existsSync(resolve(ROOT, file))) file = `img/${slug}-${n++}.jpg`;
  const tmp = join(tmpdir(), `ce-swap-${Date.now()}`);
  writeFileSync(tmp, Buffer.from(dataB64, 'base64'));
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72',
    '--resampleHeightWidthMax', '1800', tmp, '--out', resolve(ROOT, file)], { stdio: 'ignore' });
  writeFileSync(SOURCE, html.slice(0, at) + file + html.slice(at + oldUrl.length));
  return { file, replaced: 1, of: positions.length };
}


// ── layout mode: spacing overrides + section order ──
// Spacing is written as one <style id="le-overrides"> block rather than inline
// styles, so the source markup stays clean and a bad pass can be undone by
// deleting one block. Section order physically moves the <section> blocks.
const OVERRIDE_OPEN = '<style id="le-overrides">';

function writeOverrides(css) {
  let file = readFileSync(SOURCE, 'utf8');
  const block = OVERRIDE_OPEN + '\n/* spacing and text size set in layout mode — safe to hand-edit or delete */\n'
    + css.trim() + '\n</style>';
  const at = file.indexOf(OVERRIDE_OPEN);
  if (at === -1) {
    file = file.replace('</head>', block + '\n</head>');
  } else {
    const end = file.indexOf('</style>', at) + '</style>'.length;
    file = file.slice(0, at) + block + file.slice(end);
  }
  writeFileSync(SOURCE, file);
}

function reorderSections(order) {
  const file = readFileSync(SOURCE, 'utf8');
  // each block is the <section> plus the banner comment directly above it.
  // sections are never nested here, so a non-greedy match to </section> is safe.
  // each block owns its trailing blank lines, so re-joining preserves spacing
  // exactly and a no-op reorder produces a byte-identical file
  const re = /(?:[ \t]*<!-- =+[^\n]*-->\n)?[ \t]*<section\b[^>]*\bid="([^"]+)"[\s\S]*?<\/section>\n*/g;
  const blocks = new Map();
  let first = -1, last = -1, m;
  while ((m = re.exec(file)) !== null) {
    blocks.set(m[1], m[0]);
    if (first === -1) first = m.index;
    last = m.index + m[0].length;
  }
  const current = [...blocks.keys()];
  if (!order.length || order.length !== current.length) {
    throw new Error('order lists ' + order.length + ' sections, file has ' + current.length);
  }
  for (const id of order) if (!blocks.has(id)) throw new Error('unknown section: ' + id);
  if (order.join() === current.join()) return 0;
  const rebuilt = order.map(id => blocks.get(id)).join('');
  writeFileSync(SOURCE, file.slice(0, first) + rebuilt + file.slice(last));
  return order.filter((id, i) => id !== current[i]).length;
}

const EDITOR_JS = String.raw`
(() => {
  const originals = new Map(); // el -> innerHTML at load (or at last save)
  const dirty = new Set();

  const mark = () => {
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('#ce-bar') || ['SCRIPT', 'STYLE'].includes(el.tagName)) continue;
      // interactive controls stay clickable, never editable. This used to only
      // skip controls with <=3 characters, which made buttons like the gift
      // filter's year chips ('2026', 'All years') contenteditable — and the
      // capture-phase guard below then swallowed their clicks, so the filter
      // looked broken in the editor while working fine on the published page.
      if (el.matches('button,[role="button"],input,select,textarea,summary,label,option')) continue;
      // animated counters can never save correctly (their text is JS-driven) —
      // leave them read-only and say so
      if (el.matches('[data-count]') || el.querySelector('[data-count]')) {
        el.addEventListener('click', () => flash('animated number — ask the agent to change it'), { once: false });
        continue;
      }
      const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!hasText || el.closest('[contenteditable="true"]') ) continue;
      el.contentEditable = 'true';
      originals.set(el, el.innerHTML);
      el.addEventListener('input', () => {
        el.innerHTML === originals.get(el) ? dirty.delete(el) : dirty.add(el);
        refresh();
      });
      el.addEventListener('click', e => { if (el.closest('a')) e.preventDefault(); });
    }
  };

  // clicks/keys inside editable text must not trigger the page's own widgets
  // (anchors, hotkeys) — stop them in capture phase.
  document.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('#ce-bar')) return;
    const editable = e.target.closest && e.target.closest('[contenteditable="true"]');
    if (editable) e.stopPropagation();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.target.isContentEditable && !((e.metaKey || e.ctrlKey) && e.key === 's')) e.stopPropagation();
  }, true);

  const bar = document.createElement('div');
  bar.id = 'ce-bar';
  bar.innerHTML = '<span id="ce-count"></span><button id="ce-mode">Layout</button><button id="ce-save">Save</button>';
  const css = document.createElement('style');
  css.textContent = [
    '#ce-bar{position:fixed;bottom:18px;right:18px;z-index:99999;display:flex;gap:10px;align-items:center;',
    'background:#111;color:#eee;padding:10px 14px;border-radius:999px;font:13px/-apple-system,sans-serif;',
    'box-shadow:0 4px 20px rgba(0,0,0,.4)}',
    '#ce-save{background:#4a7c59;color:#fff;border:0;padding:6px 16px;border-radius:999px;cursor:pointer;font-size:13px}',
    '#ce-save:disabled{background:#444;cursor:default}',
    '#ce-mode{background:#333;color:#eee;border:0;padding:6px 14px;border-radius:999px;cursor:pointer;font-size:13px}',
    '#ce-mode.on{background:#c9a227;color:#1b1b1b}',
    'body.le-mode [contenteditable]{cursor:default}',
    'body.le-mode .le-hot:hover{outline:1px dashed rgba(201,162,39,.85);outline-offset:2px}',
    '#le-ov{position:absolute;z-index:99998;pointer-events:none;display:none;outline:1px solid rgba(201,162,39,.9)}',
    '#le-ov .le-h{position:absolute;left:0;right:0;height:14px;pointer-events:auto;cursor:ns-resize;',
    'background:rgba(201,162,39,.85);border-radius:3px}',
    '#le-ov .le-top{top:-7px}  #le-ov .le-bot{bottom:-7px}',
    '#le-ov .le-size{position:absolute;top:0;bottom:0;width:14px;right:-7px;pointer-events:auto;cursor:ns-resize;',
    'background:rgba(74,124,89,.9);border-radius:3px}',
    '#le-ov .le-size::after{content:"T";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
    'color:#fff;font:bold 10px/1 -apple-system,sans-serif}',
    '#le-ov .le-tag{position:absolute;right:0;top:-30px;background:#1b1b1b;color:#e9d9a4;font:11px/1.6 -apple-system,sans-serif;',
    'padding:2px 8px;border-radius:4px;white-space:nowrap}',
    '#le-ov .le-scope{position:absolute;left:0;top:-30px;pointer-events:auto;cursor:pointer;border:0;',
    'background:#4a7c59;color:#fff;font:11px/1.6 -apple-system,sans-serif;padding:2px 9px;border-radius:4px}',
    '#le-ov .le-scope.all{background:#c9a227;color:#1b1b1b;font-weight:600}',
    '.le-grip{position:absolute;top:8px;left:8px;z-index:99997;display:none;align-items:center;gap:6px;',
    'background:#1b1b1b;color:#e9d9a4;border:0;border-radius:999px;padding:5px 12px;font:11px/1.4 -apple-system,sans-serif;cursor:grab}',
    'body.le-mode .le-grip{display:inline-flex}',
    'section.le-dragging{opacity:.55;outline:2px dashed rgba(201,162,39,.9)}',
    '[contenteditable="true"]:hover{outline:1px dashed rgba(120,160,255,.6);outline-offset:2px}',
    '[contenteditable="true"]:focus{outline:2px solid rgba(120,160,255,.9);outline-offset:2px;cursor:text}',
  ].join('');
  document.head.appendChild(css);
  document.body.appendChild(bar);
  const count = bar.querySelector('#ce-count');
  const saveBtn = bar.querySelector('#ce-save');
  const modeBtn = bar.querySelector('#ce-mode');

  const refresh = () => {
    if (LAYOUT) {
      var n = spacing.size + (orderDirty ? 1 : 0);
      count.textContent = n
        ? (spacing.size ? spacing.size + ' layout change' + (spacing.size > 1 ? 's' : '') : '')
          + (spacing.size && orderDirty ? ' + ' : '') + (orderDirty ? 'section order' : '')
        : 'layout mode — click an element; gold bars = spacing, green T = text size';
      saveBtn.disabled = !n;
      return;
    }
    count.textContent = dirty.size ? dirty.size + ' unsaved edit' + (dirty.size > 1 ? 's' : '') : 'copy-edit mode';
    saveBtn.disabled = !dirty.size;
  };

  const domOrder = (a, b) => (a.compareDocumentPosition(b) & 4) ? -1 : 1;

  async function save() {
    if (!dirty.size) return;
    const els = [...dirty].sort(domOrder);
    const edits = els.map(el => {
      const orig = originals.get(el);
      if (orig.length < 15) {
        // short edit: rebuild the ORIGINAL outerHTML as context (current
        // outerHTML has the new inner, so splice the old one back in)
        const outerNow = el.outerHTML;
        const inner = el.innerHTML;
        const at = outerNow.lastIndexOf(inner);
        const origOuter = at === -1 ? null : outerNow.slice(0, at) + orig + outerNow.slice(at + inner.length);
        if (origOuter) return { orig: origOuter, next: outerNow };
      }
      return { orig, next: el.innerHTML };
    });
    saveBtn.textContent = 'Saving…';
    try {
      const res = await fetch('/__save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edits) });
      const out = await res.json();
      els.forEach((el, i) => { if (out.results[i].applied) { originals.set(el, el.innerHTML); dirty.delete(el); } });
      saveBtn.textContent = out.failed ? out.failed + ' failed (logged)' : 'Saved ✓';
    } catch (e) {
      saveBtn.textContent = 'Save failed';
    }
    setTimeout(() => { saveBtn.textContent = 'Save'; refresh(); }, 1800);
    refresh();
  }

  saveBtn.addEventListener('click', () => (LAYOUT ? saveLayout() : save()));
  window.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); LAYOUT ? saveLayout() : save(); }
  });

  // ── drag & drop photo swap ──
  const flash = msg => { count.textContent = msg; setTimeout(refresh, 2600); };
  // hit-test the whole element stack under the cursor — photos often sit
  // BEHIND text overlays (absolutely-positioned siblings), so walking up
  // from e.target misses them.
  const bgTarget = (x, y) => {
    for (const n of document.elementsFromPoint(x, y)) {
      if (n.closest && n.closest('#ce-bar')) continue;
      if (n.tagName === 'IMG' && n.getAttribute('src')) return { el: n, kind: 'img', url: n.getAttribute('src') };
      const bg = getComputedStyle(n).backgroundImage;
      const m = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (m) return { el: n, kind: 'bg', url: m[1] };
    }
    return null;
  };
  const toPath = u => { try { const x = new URL(u, location.href); return x.pathname.replace(/^\//, ''); } catch { return u; } };
  let hoverEl = null;
  const clearHover = () => { if (hoverEl) { hoverEl.style.outline = ''; hoverEl.style.outlineOffset = ''; hoverEl = null; } };
  document.addEventListener('dragover', e => {
    e.preventDefault();
    const t = bgTarget(e.clientX, e.clientY);
    if (hoverEl && (!t || t.el !== hoverEl)) clearHover();
    if (t) {
      hoverEl = t.el === document.documentElement || t.el === document.body ? null : t.el;
      if (hoverEl) { hoverEl.style.outline = '4px solid #C9A227'; hoverEl.style.outlineOffset = '-4px'; }
    }
  });
  window.addEventListener('dragend', clearHover);
  document.addEventListener('drop', async e => {
    e.preventDefault();
    clearHover();
    const t = bgTarget(e.clientX, e.clientY);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!t || !f) return;
    if (!/^image\//.test(f.type) && !/\.(heic|heif)$/i.test(f.name)) { flash('not an image'); return; }
    flash('swapping photo…');
    // which instance of this image (in DOM order) did the drop land on?
    // photo refs live in inline styles + img[src], so DOM order == file order
    const path = toPath(t.url);
    const refs = [...document.querySelectorAll('img[src],[style*="background-image"]')]
      .filter(el => (el.getAttribute('src') || el.getAttribute('style') || '').includes(path));
    const occurrence = Math.max(0, refs.indexOf(t.el));
    const dataB64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(f); });
    try {
      const resp = await fetch('/__swapimg', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldUrl: path, name: f.name, dataB64, occurrence, total: refs.length || 1 }) });
      const out = await resp.json();
      if (out.error) throw new Error(out.error);
      const bust = '/' + out.file + '?t=' + Date.now();
      if (t.kind === 'img') t.el.src = bust; else t.el.style.backgroundImage = 'url(' + bust + ')';
      flash(out.of > 1 ? 'photo swapped ✓ (this card only — ' + (out.of - 1) + ' other use' + (out.of > 2 ? 's' : '') + ' of the old image untouched)' : 'photo swapped ✓');
    } catch (err) { flash('swap failed: ' + err.message); }
  });
  window.addEventListener('beforeunload', e => { if (dirty.size || spacing.size || orderDirty) e.preventDefault(); });


  // ── layout mode: nudge spacing, reorder sections ──
  // Spacing is expressed as margin on a generated CSS path, never as inline
  // style, so the markup stays clean and the whole pass is one style block.
  var LAYOUT = false, sel = null, orderDirty = false;
  var spacing = new Map();   // selector -> {mt, mb}
  var baseOrder = [];

  var liveStyle = document.createElement('style');
  liveStyle.id = 'le-live';
  document.head.appendChild(liveStyle);

  function secIds() {
    return [].slice.call(document.querySelectorAll('body > section')).map(function (x) { return x.id; });
  }

  function cssPath(el) {
    var parts = [], n = el;
    while (n && n.nodeType === 1 && n !== document.body) {
      if (n.id) { parts.unshift('#' + n.id); return parts.join(' > '); }
      var par = n.parentElement; if (!par) break;
      var i = Array.prototype.indexOf.call(par.children, n) + 1;
      parts.unshift(n.tagName.toLowerCase() + ':nth-child(' + i + ')');
      n = par;
    }
    parts.unshift('body');
    return parts.join(' > ');
  }

  // a heading sized with clamp()/vw scales with the window; overriding it with a
  // fixed px pins it, which shows up as oversized type on mobile. Detect and warn.
  var fluidCache = new Map();
  function isFluid(el) {
    var key = cssPath(el);
    if (fluidCache.has(key)) return fluidCache.get(key);
    var found = false;
    for (var i = 0; i < document.styleSheets.length && !found; i++) {
      var rules;
      try { rules = document.styleSheets[i].cssRules; } catch (err) { continue; }
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        if (!r.selectorText || !r.style || !r.style.fontSize) continue;
        var fsv = r.style.fontSize;
        if (fsv.indexOf('clamp') === -1 && fsv.indexOf('vw') === -1) continue;
        try { if (el.matches(r.selectorText)) { found = true; break; } } catch (err) {}
      }
    }
    fluidCache.set(key, found);
    return found;
  }

  // The green handle means different things by element: text gets font-size,
  // anything without its own text (images, logo wrappers, media) gets width —
  // font-size on an <img> silently does nothing, which is the bug this fixes.
  function sizesByWidth(el) {
    if (/^(IMG|SVG|VIDEO|CANVAS|PICTURE)$/.test(el.tagName)) return true;
    return ![].some.call(el.childNodes, function (n) {
      return n.nodeType === 3 && n.textContent.trim();
    });
  }
  function sizeOf(el, cur) {
    if (sizesByWidth(el)) {
      return typeof cur.w === 'number' ? cur.w : Math.round(el.getBoundingClientRect().width);
    }
    return typeof cur.fs === 'number' ? cur.fs : parseFloat(getComputedStyle(el).fontSize) || 16;
  }

  // A change can target just the clicked element (positional path) or every
  // element of the same kind (its class, or failing that its tag). Scoping to a
  // class is what you want for repeated furniture like .eyebrow.
  var scopeAll = false;
  function classOf(el) {
    return (typeof el.className === 'string' ? el.className : '')
      .split(/\s+/).filter(function (c) { return c && c !== 'le-hot'; })[0] || '';
  }
  function groupSel(el) {
    var c = classOf(el);
    return c ? '.' + c : el.tagName.toLowerCase();
  }
  function activeKey() {
    return scopeAll ? groupSel(sel) : cssPath(sel);
  }

  function buildCss() {
    var out = [];
    spacing.forEach(function (v, k) {
      var d = [];
      if (typeof v.mt === 'number') d.push('margin-top:' + Math.round(v.mt) + 'px');
      if (typeof v.mb === 'number') d.push('margin-bottom:' + Math.round(v.mb) + 'px');
      if (typeof v.fs === 'number') d.push('font-size:' + (Math.round(v.fs * 10) / 10) + 'px');
      if (typeof v.w === 'number') d.push('width:' + Math.round(v.w) + 'px', 'max-width:none', 'height:auto');
      // this is an override layer and has to beat the page's own rules — a bare
      // .eyebrow loses to .imgstat .eyebrow, so every declaration is !important
      if (d.length) out.push(k + ' { ' + d.map(function (x) { return x + ' !important'; }).join('; ') + ' }');
    });
    return out.join('\n');
  }
  function renderLive() { liveStyle.textContent = buildCss(); }

  var ov = document.createElement('div');
  ov.id = 'le-ov';
  ov.innerHTML = '<div class="le-h le-top"></div><div class="le-h le-bot"></div>'
    + '<div class="le-size" title="drag up to enlarge (text size, or width for images)"></div>'
    + '<button type="button" class="le-scope"></button><div class="le-tag"></div>';
  document.body.appendChild(ov);
  var tag = ov.querySelector('.le-tag');
  var scopeBtn = ov.querySelector('.le-scope');

  function paintScope() {
    if (!sel) return;
    var g = groupSel(sel);
    var n = document.querySelectorAll(g).length;
    scopeBtn.textContent = scopeAll ? ('all ' + g + ' (' + n + ')') : 'this one';
    scopeBtn.classList.toggle('all', scopeAll);
    scopeBtn.title = scopeAll
      ? 'applying to every ' + g + ' on the page — click for this one only'
      : 'applying to this element only — click to apply to all ' + n + ' ' + g;
  }

  scopeBtn.addEventListener('click', function (e) {
    e.preventDefault(); e.stopPropagation();
    if (!sel) return;
    var from = activeKey();
    scopeAll = !scopeAll;
    var to = activeKey();
    if (spacing.has(from) && from !== to) { spacing.set(to, spacing.get(from)); spacing.delete(from); }
    renderLive(); placeOverlay(); refresh();
  });

  function placeOverlay() {
    if (!sel) { ov.style.display = 'none'; return; }
    var r = sel.getBoundingClientRect();
    ov.style.display = 'block';
    ov.style.top = (r.top + window.scrollY) + 'px';
    ov.style.left = (r.left + window.scrollX) + 'px';
    ov.style.width = r.width + 'px';
    ov.style.height = r.height + 'px';
    var cur = spacing.get(activeKey()) || {};
    var cs = getComputedStyle(sel);
    var mt = typeof cur.mt === 'number' ? cur.mt : parseFloat(cs.marginTop) || 0;
    var mb = typeof cur.mb === 'number' ? cur.mb : parseFloat(cs.marginBottom) || 0;
    var byW = sizesByWidth(sel);
    var sizeVal = sizeOf(sel, cur);
    var pinned = !byW && typeof cur.fs === 'number' && isFluid(sel);
    var cls = (typeof sel.className === 'string' ? sel.className : '').split(/\s+/)
      .filter(function (c) { return c && c !== 'le-hot'; })[0];
    tag.textContent = sel.tagName.toLowerCase() + (cls ? '.' + cls : '')
      + '  ↑' + Math.round(mt) + '  ↓' + Math.round(mb)
      + (byW ? '  W' : '  T') + (Math.round(sizeVal * 10) / 10) + 'px'
      + (pinned ? '  ⚠ pinned' : '');
    paintScope();
  }

  function select(el) {
    sel = el;
    // a fresh selection starts scoped to itself unless a group rule already exists
    scopeAll = spacing.has(groupSel(el)) && !spacing.has(cssPath(el));
    placeOverlay();
    refresh();
  }

  document.addEventListener('click', function (e) {
    if (!LAYOUT) return;
    if (e.target.closest('#ce-bar') || e.target.closest('#le-ov') || e.target.closest('.le-grip')) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target;
    if (el === document.body || el.tagName === 'HTML') return;
    select(el);
  }, true);

  // drag a handle: down = more space on that side
  var drag = null;
  ov.addEventListener('mousedown', function (e) {
    var sz = e.target.closest('.le-size');
    if (sz && sel) {
      e.preventDefault();
      var k0 = activeKey(), c0 = spacing.get(k0) || {};
      var byW0 = sizesByWidth(sel);
      drag = { side: byW0 ? 'w' : 'fs', y0: e.clientY, key: k0, base: sizeOf(sel, c0) };
      if (!byW0 && isFluid(sel)) flash('this text scales with the window — resizing pins it');
      return;
    }
    var h = e.target.closest('.le-h');
    if (!h || !sel) return;
    e.preventDefault();
    var key = activeKey(), cur = spacing.get(key) || {};
    var cs = getComputedStyle(sel);
    drag = {
      side: h.classList.contains('le-top') ? 'mt' : 'mb',
      y0: e.clientY, key: key,
      base: h.classList.contains('le-top')
        ? (typeof cur.mt === 'number' ? cur.mt : parseFloat(cs.marginTop) || 0)
        : (typeof cur.mb === 'number' ? cur.mb : parseFloat(cs.marginBottom) || 0)
    };
  });
  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var cur = spacing.get(drag.key) || {};
    var dy = e.clientY - drag.y0;
    var v = drag.side === 'fs' ? Math.max(8, Math.round((drag.base - dy / 3) * 2) / 2)
          : drag.side === 'w'  ? Math.max(16, Math.round(drag.base - dy))
          : Math.max(0, Math.round((drag.base + dy) / 2) * 2);
    cur[drag.side] = v;
    spacing.set(drag.key, cur);
    renderLive(); placeOverlay();
  });
  window.addEventListener('mouseup', function () { if (drag) { drag = null; refresh(); } });

  // arrow keys nudge the selected element's spacing
  window.addEventListener('keydown', function (e) {
    if (!LAYOUT || !sel || e.metaKey || e.ctrlKey) return;
    if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      e.preventDefault();
      var fk = activeKey(), fc = spacing.get(fk) || {};
      var byWk = sizesByWidth(sel);
      var fstep = byWk ? (e.shiftKey ? 20 : 4) : (e.shiftKey ? 4 : 1);
      var fbase = sizeOf(sel, fc);
      var nv = fbase + ((e.key === '-' || e.key === '_') ? -fstep : fstep);
      if (byWk) fc.w = Math.max(16, nv); else fc.fs = Math.max(8, nv);
      spacing.set(fk, fc);
      if (!byWk && isFluid(sel)) flash('this text scales with the window — resizing pins it');
      renderLive(); placeOverlay(); refresh();
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    var step = e.shiftKey ? 10 : 2, key = activeKey();
    var cur = spacing.get(key) || {};
    var cs = getComputedStyle(sel);
    var base = typeof cur.mt === 'number' ? cur.mt : parseFloat(cs.marginTop) || 0;
    cur.mt = Math.max(0, base + (e.key === 'ArrowDown' ? step : -step));
    spacing.set(key, cur);
    renderLive(); placeOverlay(); refresh();
  });

  // ── section reorder ──
  function addGrips() {
    var secs = document.querySelectorAll('body > section');
    for (var i = 0; i < secs.length; i++) {
      var s0 = secs[i];
      if (s0.querySelector('.le-grip')) continue;
      if (getComputedStyle(s0).position === 'static') s0.style.position = 'relative';
      var g = document.createElement('button');
      g.type = 'button';
      g.className = 'le-grip';
      g.textContent = '⁙ ' + (s0.id || 'section');
      s0.insertBefore(g, s0.firstChild);
    }
  }

  var dragSec = null;
  document.addEventListener('mousedown', function (e) {
    if (!LAYOUT) return;
    var g = e.target.closest && e.target.closest('.le-grip');
    if (!g) return;
    e.preventDefault(); e.stopPropagation();
    dragSec = g.closest('section');
    dragSec.classList.add('le-dragging');
    ov.style.display = 'none';
  }, true);
  window.addEventListener('mousemove', function (e) {
    if (!dragSec) return;
    var secs = [].slice.call(document.querySelectorAll('body > section'));
    var di = secs.indexOf(dragSec);
    for (var i = 0; i < secs.length; i++) {
      if (i === di) continue;
      var r = secs[i].getBoundingClientRect();
      var mid = r.top + r.height / 2;
      if (i < di && e.clientY < mid) { secs[i].parentNode.insertBefore(dragSec, secs[i]); orderDirty = true; break; }
      if (i > di && e.clientY > mid) { secs[i].parentNode.insertBefore(dragSec, secs[i].nextSibling); orderDirty = true; break; }
    }
  });
  window.addEventListener('mouseup', function () {
    if (!dragSec) return;
    dragSec.classList.remove('le-dragging');
    dragSec = null;
    refresh();
  });

  function setMode(on) {
    LAYOUT = on;
    document.body.classList.toggle('le-mode', on);
    modeBtn.classList.toggle('on', on);
    modeBtn.textContent = on ? 'Text' : 'Layout';
    originals.forEach(function (_v, el) {
      el.contentEditable = on ? 'false' : 'true';
      el.classList.toggle('le-hot', on);
    });
    if (on) addGrips(); else { sel = null; ov.style.display = 'none'; }
    refresh();
  }

  async function saveLayout() {
    var order = secIds();
    saveBtn.textContent = 'Saving…';
    try {
      var r = await fetch('/__layout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ css: buildCss(), order: order })
      });
      var out = await r.json();
      if (out.error) { saveBtn.textContent = 'Layout failed'; flash(out.error); }
      else {
        saveBtn.textContent = 'Saved ✓';
        baseOrder = order; orderDirty = false;
      }
    } catch (err) { saveBtn.textContent = 'Save failed'; }
    setTimeout(function () { saveBtn.textContent = 'Save'; refresh(); }, 1800);
  }

  modeBtn.addEventListener('click', () => setMode(!LAYOUT));
  window.addEventListener('scroll', () => { if (LAYOUT && sel) placeOverlay(); }, { passive: true });
  window.addEventListener('resize', () => { if (LAYOUT && sel) placeOverlay(); });

  mark();
  baseOrder = secIds();
  refresh();
})();
`;

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/__swapimg') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      try {
        const out = swapImage(JSON.parse(body));
        console.log(`[swap] ${out.file} (${out.replaced} refs)`);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
      } catch (e) {
        console.error('[swap] failed:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(e.message || e) }));
      }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/__layout') {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      try {
        const { css, order } = JSON.parse(body);
        if (typeof css === 'string') writeOverrides(css);
        const moved = Array.isArray(order) && order.length ? reorderSections(order) : 0;
        console.log('[layout] rules saved, ' + moved + ' section(s) moved');
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, moved }));
      } catch (e) {
        console.log('[layout] FAILED ' + e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(e.message || e) }));
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/__save') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      try {
        const out = applyEdits(JSON.parse(body));
        console.log(`[save] applied ${out.applied}, failed ${out.failed}`);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500).end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = readFileSync(SOURCE, 'utf8').replace('</body>', `<script>${EDITOR_JS}</script></body>`);
    res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(html);
    return;
  }
  // these reports carry spaces in asset paths ('Biome reports/Apr - Jul 2026/...'),
  // so the percent-encoded pathname must be decoded before it resolves to a file.
  // decode first, then normalize — the startsWith(ROOT) guard below still catches traversal.
  const file = resolve(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, ''));
  if (file.startsWith(ROOT) && existsSync(file)) {
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
    return;
  }
  res.writeHead(404).end('not found');
}).listen(PORT, () => console.log(`copy-edit server → http://localhost:${PORT}  (source: ${SOURCE})`));
