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

const EDITOR_JS = String.raw`
(() => {
  const originals = new Map(); // el -> innerHTML at load (or at last save)
  const dirty = new Set();

  const mark = () => {
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('#ce-bar') || ['SCRIPT', 'STYLE'].includes(el.tagName)) continue;
      // leaf interactive controls (close buttons etc.) stay clickable, not editable
      if (el.matches('button,[role="button"],input,select,textarea,summary') && el.textContent.trim().length <= 3) continue;
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
  bar.innerHTML = '<span id="ce-count"></span><button id="ce-save">Save</button>';
  const css = document.createElement('style');
  css.textContent = [
    '#ce-bar{position:fixed;bottom:18px;right:18px;z-index:99999;display:flex;gap:10px;align-items:center;',
    'background:#111;color:#eee;padding:10px 14px;border-radius:999px;font:13px/-apple-system,sans-serif;',
    'box-shadow:0 4px 20px rgba(0,0,0,.4)}',
    '#ce-save{background:#4a7c59;color:#fff;border:0;padding:6px 16px;border-radius:999px;cursor:pointer;font-size:13px}',
    '#ce-save:disabled{background:#444;cursor:default}',
    '[contenteditable="true"]:hover{outline:1px dashed rgba(120,160,255,.6);outline-offset:2px}',
    '[contenteditable="true"]:focus{outline:2px solid rgba(120,160,255,.9);outline-offset:2px;cursor:text}',
  ].join('');
  document.head.appendChild(css);
  document.body.appendChild(bar);
  const count = bar.querySelector('#ce-count');
  const saveBtn = bar.querySelector('#ce-save');

  const refresh = () => {
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

  saveBtn.addEventListener('click', save);
  window.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
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
  window.addEventListener('beforeunload', e => { if (dirty.size) e.preventDefault(); });

  mark();
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
