# TODO — Impact Report 2026 (web)

## Done
- [x] Repo created (private, Biome-Trust org)
- [x] Design system: Biome palette + Tiempos/Inter + Mangaroa band rhythm
- [x] Ten-section skeleton matching the Figma `DRAFT - LATEST` running order
- [x] Copy-edit server ported and pointed at `index.html`
- [x] Render verified: fonts load, all images 200, band rhythm holds

## Next — content pass
All copy is now in from the Figma.
- [x] Giftee directory pulled from biometrust.earth/gifts (2026-09-16): 68 orgs,
      FY22–FY26, each with the site's own photo, blurb and website URL. Year
      counts match the source exactly (45/23/20/12/8).
- [ ] Region pills — only the 20 curated ones carry a region; the gifts page
      does not publish region, so the rest show none
- [x] Milestone bullets for Toru Education, Centre for Strategic Philanthropy,
      The Gift Trust (2026-10-13) — the Centre's came from G; no feature on the
      page carries the placeholder tag any more. The .ph-tag / .is-placeholder
      CSS is kept for the next one that needs it.
- [x] Financial-year tagging (2026-09-16) — retagged from the gifts spreadsheet:
      FY26 18 orgs, FY27 43. The gifts page groups by calendar year, which
      straddles the financial year; the spreadsheet is the source of truth.
- [ ] Confirm the 10 orgs inferred into FY27 (screenshot cut at row 182):
      Earth Repair Fund, Eco-Index, Fundsorter, Mangarara Farm, Ocean Vision
      Legal, Regenerative Earth, Regenerosity, Roebuck Farms, Tiwaiwaka
      Collective, Wakatū Incorporation
- [ ] 2025/2024/2023/2022 are still the gifts page's calendar-year groupings,
      not financial years — they need the same treatment when the data exists
- [ ] Wire the newsletter block to Klaviyo (account UZXSkU, form Xa8XP7); the
      fields are inert and the page says so
- [ ] Forestry wording on the Mangaroa offerings row is ours, not Mangaroa's

## Mobile pass (375px, verified live)
- [x] Cover: headline sized to the date line, then taken down 25% (15.1vw)
- [x] Kia ora letter reads as continuous prose when the columns stack
- [x] Giving by numbers: currency card full width, bigger heading, more air
- [x] One size for every section h2 — clamp(34px, 11.4vw, 44px); the ceiling is
      "Backing partners", which needs 7.5x its font size to hold its own line
- [x] Band title lede runs to 80vw
- [x] +31% chip: 12px padding all round, inset 16px top and right
- [x] Twice the air under a featured giftee; a fifth off the "All Giftees" foot
- [ ] Still untouched at phone width: Mangaroa head, Ma Earth head, the kaupapa
      map and its hover labels, the 62-card giftee grid, the endowment four-up

## Off the page, kept on file (G's call)
Removed from the All Giftees grid. Images are still in `img/gifts/`, so any of
these can be put back with the row below.

The first three went on 2026-10-27 and were FY27-only, so they did not touch the
FY26 count. Regenerative Finance Foundation went on 2026-10-28 as an
international gift. G wants a **"Global Gifts" tab** built later to hold all four
rather than mixing them into the year filters.

**Island Futures was briefly removed on 2026-10-29 and then restored**, after G
confirmed it is NZ based. The dashboard agrees: its one row, "Islands for the
Future of Humanity", 14 Apr 2026, is marked NZ and FY2027. FY27 only, no other
year. Do not take it off again without checking that row.

| Org | Years | Themes | Line | Site |
|---|---|---|---|---|
| Earth Repair Fund | 2027 | conservation education finance | Educational Videos that Fund Land Restoration Projects | https://www.earthrepair.fund/ |
| Regenerative Earth | 2027 | regen | Preserving Biological Diversity and Indigenous Wisdom in Keystone Ecosystems | https://regenerativeearth.org/ |
| Regenerosity | 2027 | regen | Resourcing Grassroots Leaders and Organizations Regenerating Our Planet | https://www.regenerosity.world/ |
| Regenerative Finance Foundation | 2025 | regen finance | Accelerating Regenerative Economies | https://www.regenerative.fi/ (does not resolve) |

## Location badges, second pass (2026-10-29)
Nine cards had no badge. Five now do, each read off the organisation's own site:

| Org | Badge | Evidence |
|---|---|---|
| Aspen Institute | Queenstown | Homepage: "Based in Queenstown". No region stated, so none used. |
| Richmond Community Garden Trust | Christchurch | 235 River Road, Richmond + Eco-Hub at 46a Vogel St. Confirmed as the Christchurch Richmond (not Nelson) by Christchurch City Council funding, CCC Heritage Parks, LINZ red-zone leases, Ōtākaro/Avon projects, and "Canterbury's seventh" parkrun. |
| Corals for Conservation | Fiji | "Corals for Conservation - Fiji"; staff listed as "Site Manager (Fiji)". No city anywhere on the site. |
| Globaïa | Canada & Aotearoa | Footer on every page: "Made in Canada & Aotearoa". Team spans many countries; no single office stated. |
| Happen Films | Upper Moutere | Privacy policy: "Our registered office is at 324 Wills Road, Upper Moutere, 7175." Caveat: that page is a filled-in template with other placeholders left unfilled, but the company number and address are specifics. |

**Four still bare, each for a different reason:**

- **Common Unity** — badged **Lower Hutt** on G's call. Note the source: the site
  itself only ever writes "Te Awakairangi ki Tai" and names The ReMakery, Te Puni
  School and Epuni, with no English city name or street address anywhere. The
  Lower Hutt reading comes from G, not from the site.
- **Future Whenua** — genuinely no base on the site. The only NZ place named is
  the FY27 summit venue (Mangaroa Farms, Upper Hutt), and the site says the
  summit deliberately moves around the country. Venue is not a base.
- **Inspiring Stories** — **their website is down.** inspiringstories.org.nz
  serves a cPanel "Default Web Site Page" with a server-misconfiguration notice.
  On G's call the card's "Website →" link has been removed, along with the whole
  meta row since it had no badge either. Put it back if the site returns. Still
  worth telling the client that their giftee's site is broken.
- **SpaceBase** — spacebase.co sits behind Cloudflare bot verification. Returns
  403 to a plain fetch and an interstitial in a browser. Not worked around.

## Merged giftees (2026-10-29, G's call)
The giving dashboard lists one recipient, "Every Body Is a Treasure / Natural
Leaders", but the grid carried two cards. Merged into one.

**Survivor:** `Every Body Is a Treasure (Natural Leaders)` — keeps
`every-body-is-a-treasure.jpg`, "Wellbeing Rooted in Connection to Place",
the Wellington badge and everybodyisatreasure.org. Its years
(2027 2026 2025 2024) and themes (education community) already covered the
removed card's, so neither attribute changed.

**Removed card, kept here in case it is wanted back:**

| Field | Value |
|---|---|
| Name | Natural Leaders |
| Years | 2027 2025 |
| Themes | community |
| Line | Outdoor Leadership for Years 6-13+ |
| Badge | Hutt Valley |
| Site | https://naturalleaders.nz/ (resolves, 200) |
| Image | `img/gifts/natural-leaders.jpg`, still on disk, now unused |

Two things this loses: the naturalleaders.nz link, since a card shows only one
website, and the "Outdoor Leadership for Years 6-13+" line. Both are live and
accurate, so say if either should surface on the merged card.

Grid is now 63 cards. FY26 still counts 18, so the band lede is unchanged.

## Location badges (2026-10-28)
59 of the 62 giftee cards now carry one. Each was read off the
organisation's own site; the notable sources:

- KNECT: 32 mentions of Buller, 7 of Westport, so West Coast
- Kōanga Institute: Wairoa, so Hawke's Bay
- Wild Waikawa: 43 mentions of Marlborough, 14 of Picton
- Rites of Passage: 11 mentions of Golden Bay
- Te Tauihu Environment Trust: Te Tauihu, with Motueka named five times
- Ocean Vision Legal: "Queenstown, New Zealand" verbatim
- Eat New Zealand: "Canterbury, Aotearoa" verbatim
- Natural Leaders: Upper Hutt on their site, and Biome's own kaupapa map
  already groups them under Hutt Valley
- Takapūwāhia Marae: Takapūwāhia is in Porirua
- Nationwide bodies take "Aotearoa", matching how Eco-Index and The Gift
  Trust are badged: Bio Dynamic Association, Conservation Volunteers NZ,
  NZ Native Forests Restoration Trust, Organics Aotearoa, Rewiring
  Aotearoa, Te Tira Whakamātaki

### Still unbadged, could not source (10)
| Org | Why |
|---|---|
| Corals for Conservation | site names no country; Pacific context only |
| Richmond Community Garden Trust | "Richmond" everywhere, never which one |
| Future Whenua | no place on the site |
| Happen Films | "Aotearoa New Zealand" only |
| Globaïa | "Made in Canada & Aotearoa", so not one place |
| Aspen Institute NZ | no place on the site |
| Common Unity | commonunityproject.org.nz returns 18 bytes |
| Inspiring Stories | JS shell, no readable content |
| Spacebase | JS shell, no readable content |

## Next — assets
- [x] Cover photo — Mangaroa River aerial, the same shot as the Figma cover
- [x] Cover logo — real horizontal white Biome Trust lockup, per the Figma cover
- [ ] Check each photo isn't already used elsewhere before assigning it

## Later
- [ ] Aotearoa map for the kaupapa section
- [ ] Decide whether the report ships open or gated — the reach reports are currently
      plaintext on a public repo, which was a deliberate "temporary" call worth revisiting
- [x] Flip repo public + enable Pages — LIVE at https://biome-trust.github.io/biome-impact-report-2026/ (2026-09-15)
