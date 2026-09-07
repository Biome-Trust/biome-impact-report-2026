# Biome Trust — Impact Report 2026 (web edition)

## What this is
The web version of the Biome Trust Impact Report 2026. The report also exists as a
print-style Figma document; this repo is the scrolling web reinterpretation of it, not
an export.

## Stack
Single hand-written `index.html`. No framework, no build step, no dependencies.
GitHub Pages serves `main` / root, so **the file in the repo is the file served** —
there is no `dist/`, and nothing to promote. Prove any prod question with a byte-diff.

## Sources of truth
- **Copy and figures:** the Figma file, `DRAFT - LATEST` row (11 pages: cover, Kia ora,
  partner grid ×2, Giving by numbers, Our Approach, Mangaroa, Ma Earth, Stewarding our
  endowment, People/place/kaupapa). Never paraphrase client copy from memory — read it.
- **Design:** impact.mangaroa.org, borrowed as anatomy not as pixels.

## Design decisions
- **Palette is Biome's, structure is Mangaroa's.** Tokens (`--green-dark #1e3a1f`,
  `--green-mid`, `--tan #c8a96e`, `--cream #faf7f2`) are lifted from the approved
  quarterly reach report, so the two Biome properties stay consistent.
- **Type:** Tiempos Headline (`fonts/tiempos-headline.woff2`, variable 100–900) for
  headings, Inter for everything else. Same pairing as the reach report. The woff2 is a
  real file here rather than the base64 blob the reach report inlines.
- **Band rhythm — the rule that matters:** never two full-bleed image bands back to back.
  An image band is always separated by a light paper band or a solid deep band. Current
  order: cover(image) → paper → deep → paper → cream → mangaroa(image) → paper → cream →
  kaupapa(image) → deep footer.
- **Section anatomy:** eyebrow → serif h2 → lede → content. Reuse it for new sections;
  copy an existing block rather than inventing new markup.
- Every section carries an anchor id, so deep links and screenshot verification are cheap.

## Placeholders
Unverified facts are **never guessed**. They carry a `.tk` span (tan highlight) and,
where a whole block is outstanding, a `.note` line saying what is needed. `grep -c
'class="tk"' index.html` is the honest measure of how finished this is.

Stat cards carry a "verified by X" line where a source exists — delete the line rather
than inventing a source.

## Gotchas
- Editing is done in the browser via `scripts/copy-edit-server.mjs` (ported from
  `Mangaroa-Farms/impact`). It writes exact-string replacements back into `index.html`,
  so hand-written formatting survives and diffs stay small.
- That server was patched here to `decodeURIComponent` the request path — impact's
  assets were all slugs, but Biome's asset filenames contain spaces.
- `img/hero-mangaroa-river.jpg` is real — the Mangaroa River aerial, same shot as the
  Figma cover (and as `Biome background.png` in the reach reports, but from the
  unprocessed original rather than the pre-darkened copy). The remaining `img/*.jpg` are
  generated placeholder plates, not photography. Swap them by dragging
  real photos onto them in the browser editor (macOS `sips` does the conversion). For hero-
  scale images prefer PIL with `optimize=True, progressive=True` — on a dense aerial it beat
  `sips` roughly 3:1 at matched dimensions.
- After any browser editing pass, sweep for contenteditable artifacts: stray
  `contenteditable` attributes, `<div>` inside `<p>`, clipboard junk spans.
- NZ English: programmes, totalling, recognise.
