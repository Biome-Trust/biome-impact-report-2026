# Rewilding Resources — Biome Trust Impact Report 2026

Web edition of the Biome Trust Impact Report 2026.

- **Content source:** [Figma — Biome Trust Impact Report 2026](https://www.figma.com/design/Wbl5i66pWoKEbklpW6LY1e/Biome-Trust---Impact-Report-2026), `DRAFT - LATEST` row
- **Design reference:** [impact.mangaroa.org](https://impact.mangaroa.org) — long-scroll band rhythm, stat cards, image bands
- **Status:** scaffold. Structure and design system are in place; all copy and figures are placeholders.

## Editing

Copy is edited in the browser, not by hand:

```bash
node scripts/copy-edit-server.mjs 4747
```

Then open http://localhost:4747 — click any text to edit, ⌘S to save, drag a photo from
Finder onto any image to swap it. Edits write back into `index.html` as exact-string
replacements. Anything that can't be matched exactly is refused and logged to
`copy-edit-failures.json` rather than guessed.

Run one editor server at a time, per repo.

## Publishing

The repo is **private** and has no GitHub Pages site yet, by decision — it goes public
when the report is ready to ship. To publish: flip visibility to public, then enable
Pages on `main` / root. There is no build step; the file in the repo is the file served.
