---
name: Stackpine
description: Colour chapters. Full-bleed fields of the brand palette, stacked like the layers of the Stackpine mark.
colors:
  ground: "#F5F8F4"
  land: "#E7EFE6"
  paper: "#FFFFFF"
  navy: "#1E2D42"
  pine-900: "#1B4428"
  pine: "#2F6E3D"
  pine-400: "#6FA97A"
  pine-200: "#B9D6BE"
  blaze-field: "#2C6CAB"
  ink: "#1E2D42"
  ink-soft: "#435369"
  on-dark: "#F5F8F4"
  on-dark-soft: "#C9DCCB"
  blaze: "#3B87CC"
  blaze-light: "#9CC8EE"
  rose: "#B4493A"
typography:
  display:
    fontFamily: "League Spartan, Figtree, system-ui, sans-serif"
    fontSize: "clamp(3.4rem, 5.8vw, 6rem)"
    fontWeight: 700
    lineHeight: 0.92
    letterSpacing: "-0.045em"
  head:
    fontFamily: "League Spartan, Figtree, system-ui, sans-serif"
    fontSize: "clamp(2rem, 1.3rem + 3.2vw, 4rem)"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-0.04em"
  statement:
    fontFamily: "League Spartan, Figtree, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 1rem + 1.6vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  lead:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 1.1rem + 0.7vw, 1.625rem)"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "clamp(1.0625rem, 1rem + 0.25vw, 1.1875rem)"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  small:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "clamp(0.8125rem, 0.79rem + 0.1vw, 0.875rem)"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  none: "0px"
spacing:
  gutter: "clamp(16px, 4vw, 32px)"
  section: "clamp(80px, 10vw, 160px)"
  stack: "24px"
components:
  button:
    backgroundColor: "{colors.pine}"
    textColor: "{colors.on-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0 20px 0 24px"
    height: "52px"
  button-hover:
    backgroundColor: "{colors.pine-900}"
  button-light:
    backgroundColor: "{colors.on-dark}"
    textColor: "{colors.pine-900}"
    rounded: "{rounded.none}"
    height: "52px"
  input:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "12px 14px"
    height: "52px"
---

# Design System: Stackpine

## Overview

**Colour chapters.** Stackpine builds software one layer at a time, and its mark is a pine made of stacked layers. The site works the same way: every section is a full-bleed field of one brand colour, butted against the next with no divider, so the page reads as layers stacking up. The home hero is the mark itself, enlarged and cropped by the viewport.

The audience is non-technical small-business owners, often on a phone. The rules favour big plain type, whole fields of colour and the full content over ornaments. Art direction comes from taste-skill (direction `colour-chapters`, seed 709001197, recorded in `.taste-skill/direction.json`), with the brand palette kept.

## Colors

### Primary
- **Pine** (`pine` #2F6E3D): the one action colour. Buttons, the hero shape, the action tile.
- **Pine 900** (`pine-900` #1B4428): sub-page headers, the names chapter, the "Stackpine way" column, closing tiles.

### Secondary
- **Navy** (`navy` #1E2D42): the ink on light fields, and the staircase and footer chapters.
- **Blaze field** (`blaze-field` #2C6CAB): the pricing chapter only. `blaze-light` #9CC8EE is for alternate staircase lines and footer contact lines on dark fields.

### Tertiary
- **Rose** (`rose` #B4493A): errors and the "old way" crosses only.

### Neutral
- `ground` #F5F8F4 is the page; `land` #E7EFE6 is the quiet field; `paper` #FFF is used for panels on land (ticket, results, builds, FAQ, form).
- Text on dark fields is `on-dark` #F5F8F4; `on-dark-soft` #C9DCCB is for secondary notes only.

### Named Rules
- **One Field per Chapter.** Each section is one flat colour floor to ceiling. Neighbours differ clearly in lightness.
- **Tone, Not Lines.** Surfaces separate by a step in tone or by space. No hairlines, no outlined boxes, no shadows at rest.

## Typography

League Spartan 700 is the display face (tight tracking, leading 0.92–1.02). Figtree is the text face (400/600). Both are self-hosted in `assets/fonts/`.

### Hierarchy
- Display (home H1 and the $0 price): `clamp(3.4rem,5.8vw,6rem)`; 11.5vw on phones.
- Head (page H1, section H2): `clamp(2rem,…,4rem)`.
- Statement (staircase, names paragraph): 36px max, set as a `<p>`.
- Lead `clamp(1.25rem,…,1.625rem)`, body 17–19px, small 13–14px.

### Named Rules
- **Two-Line Headlines.** Every heading fits in two lines at 1440, 768 and 390px. Cut words before shrinking type.
- **No Eyebrows.** No label sits above a heading: no breadcrumbs, no kickers, no "Step N".

## Layout

Max width 1240px with one fluid gutter. Sections pad `clamp(80px,10vw,160px)` and butt together. Home chapters in order: ground (hero), navy (staircase), land (stages), pine (names), blaze (ticket), ground (action tile), navy (footer). Sub-pages open with a pine header split with a cover-art picture (48vw on desktop, 16:9 on phones), then alternate ground and land.

## Elevation & Depth

Flat. The only shadow is on the open mobile menu, a real overlay.

## Shapes

Square corners everywhere. The button is a signpost: a square block with a 14px arrow point on its right end, drawn with a clipped pseudo-element so the focus ring stays rectangular. The ticket has two half-round notches and a dotted perforation.

## Components

### Buttons
There is one shape (see Shapes). Pine on light fields, light on pine. Press scales to .97 over 140ms; hover darkens the colour, gated behind hover-capable pointers. Secondary actions are text links with an arrow (`.tlink`), never a second button style.

### Stages (signature component)
A horizontal accordion of tinted panels, dark to light pine: the open stage takes about 58% of the width and the rest are slivers with vertical names. It opens by click or keyboard over 420ms on ease-in-out. On phones it becomes vertical bars. Without script, every stage is open.

### Ticket
The pricing chapter: a paper ticket (7fr/3fr) with the price in the stub. It stands upright on phones.

### Names paragraph
All builds run as one statement paragraph of links on pine. Names rest in soft ink and take full ink on hover.

### Inputs / Fields
Fields have a `ground` fill, a 2px `ink-soft` border and no radius. Focus turns them pine. Invalid fields turn rose with a message under the field, linked via `aria-describedby`.

### Navigation
A plain bar: wordmark, five links, one action. The current page gets a blaze underline. The mobile menu fades and slides 8px and closes on Escape.

### Footer
The name comes first, spanning the content width, then contact lines in blaze-light, link columns, and a short legal line.

## Do's and Don'ts

### Do:
- Keep the motion layer: one shutter picture per page as the signature move, plus entrances by content (lines rise, rows slide along the row, pictures settle, long pages reveal block by block). Use transform and opacity only. Everything is visible without script, and reduced motion holds nothing back.
- Use real pictures. Today these are crops of `cover.jpg` (Stackpine's own art); replace them with real photographs when available.

### Effects layer (`assets/fx.js`)
A single requestAnimationFrame loop that eases every value and writes only transform, opacity and visibility. It never runs under `prefers-reduced-motion`, and the page works without it.
- **Pine build:** on load the trunk lands, then each chevron stacks on, then the tip (110ms apart, 720ms each, ease-out).
- **Pine reacts:** scrolling spreads the layers into an exploded view; on hover-capable pointers the layers drift by depth.
- **Chapter stack:** home sections are sticky (pinned at their bottom edge when taller than the screen). Each slides over the last, which scales to 0.94 and dims to 55% over a #0B1320 backdrop, then stops painting once fully covered. This deliberately breaks taste-skill's covered-text rule.
- **Word reveal:** page and home H1s rise word by word from a mask (70ms apart).
- **Scroll-lit text:** the staircase lights line by line and the names paragraph name by name.
- **Countdown:** the price counts from $40,000 to $0 (1.6s, ease-out). The real "$0" is in screen-reader text.
- **Magnetic buttons:** buttons lean up to 8px towards the pointer using the `translate` property, so the press `scale` still works.
- **Drift:** header and staircase pictures drift slower than the page.

### Don't:
- Don't use eyebrows, monospace, index numbers, hairlines, gradients, resting shadows or glass.
- Don't put cards on the fields, and don't use rows of identical cards.
- Don't style an accent word in a headline (no italic or coloured word mid-heading).
