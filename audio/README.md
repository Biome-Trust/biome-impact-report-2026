# Ambient birdsong

Drop a file here named **`birdsong.mp3`** and the "Birdsong" control appears at the
bottom-left of the report on its own. Remove the file and the control disappears —
`index.html` checks the file loads before it shows anything, so a missing file never
renders a broken button.

## What the player does
- **Never autoplays.** Browsers block sound without a user gesture, and unrequested
  audio on a report is hostile. It is opt-in, one click.
- Loops, fades in and out rather than cutting, and sits at 35% volume.
- Remembers the visitor's choice in `localStorage`. A returning visitor who had it on
  gets it back on their first click anywhere — the gesture browsers require.
- Respects `prefers-reduced-motion` for the animated bars.

## Sourcing the file
It has to be a recording Biome Trust has the right to publish. The report is public,
so a track lifted from someone's YouTube upload is not safe to host.

Reasonable routes:
- A recording Biome or Mangaroa Farms made on the whenua — the best option, and true
  to the place.
- Freesound (filter to CC0), or Xeno-canto for named NZ species (check each
  recording's licence; many are CC-BY and need attribution).
- DOC and some regional councils publish native birdsong recordings — check terms.

Keep it to 60–90 seconds and it loops without anyone noticing. Encode as mono MP3 at
96–128 kbps; stereo and higher bitrates are wasted on ambience and cost load time.
