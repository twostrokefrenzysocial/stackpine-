---
name: Stackpine
description: Trailhead. Pine-green sign boards on a light map ground, with blue trail blazes marking the way.
colors:
  ground: "#F5F8F4"
  land: "#E7EFE6"
  paper: "#FFFFFF"
  rule: "#CFD9CF"
  rule-strong: "#A3B3A6"
  ink: "#1E2D42"
  ink-2: "#435369"
  ink-3: "#5A6779"
  board: "#1B4428"
  board-edge: "#123019"
  routed: "#F1EBCF"
  routed-dim: "#C9DCCB"
  pine: "#2F6E3D"
  pine-deep: "#245730"
  blaze: "#3B87CC"
  rose: "#B4493A"
typography:
  display:
    fontFamily: "Overpass, Public Sans, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 5.8vw, 4.6rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Overpass, Public Sans, system-ui, sans-serif"
    fontSize: "clamp(1.85rem, 3.6vw, 2.7rem)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.018em"
  title:
    fontFamily: "Overpass, Public Sans, system-ui, sans-serif"
    fontSize: "1.38rem"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.018em"
  body:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  lede:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "clamp(1.05rem, 1.5vw, 1.2rem)"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "3px"
  sign: "10px"
spacing:
  gutter: "clamp(16px, 5vw, 48px)"
  section: "clamp(64px, 9vw, 120px)"
  stack: "22px"
components:
  button-primary:
    backgroundColor: "{colors.pine}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "12px 22px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.pine-deep}"
  button-primary-on-board:
    backgroundColor: "{colors.routed}"
    textColor: "{colors.board}"
    rounded: "{rounded.sm}"
    padding: "12px 22px"
    height: "48px"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px 22px"
    height: "48px"
  board:
    backgroundColor: "{colors.board}"
    textColor: "{colors.routed}"
    rounded: "{rounded.sign}"
  input:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "11px 14px"
    height: "48px"
---

# Design System: Stackpine

## Overview

**Trailhead.** Custom software is a trail you walk one marker at a time, not a $40,000 cliff. The site is the trailhead: each page header and closing call to action is a deep pine-green sign board, the ground is a light, cool park-map white, and blue blazes (the Buckeye Trail's colour) are the only marker system. Logo navy carries the text.

The audience is non-technical small-business owners, often reading on a phone between jobs. The system favours plain reading order, large touch targets and calm surfaces over effects. Pine boards are where the page speaks loudest; everything between them is quiet, ruled and light.

## Colors

### Primary
- **Board** (`board` #1B4428): the sign. Used only for page heads, the home hero and closing boards.
- **Routed** (`routed` #F1EBCF): lettering and primary buttons on the board. It is never used as a page ground.
- **Pine** (`pine` #2F6E3D): primary buttons, links and metrics on the light ground.

### Secondary
- **Blaze** (`blaze` #3B87CC): trail blazes (2:5 rectangles), the active nav underline and focus rings. It is a marker, not a text colour.

### Tertiary
- **Rose** (`rose` #B4493A): errors and the "problem" crosses only.

### Neutral
- `ground` #F5F8F4 is the page; `land` #E7EFE6 tints alternate sections; `paper` #FFF is used for forms and the hero's start box.
- Ink ramp: `ink` #1E2D42 (headings and body emphasis), `ink-2` #435369 (body), `ink-3` #5A6779 (meta). All pass AA on every ground, with the lowest pair at 4.9:1.

### Named Rules
- **The Board Rule.** Pine fills only page heads and closing boards, at most two boards per page. Featured content gets weight from size, not from the board.
- **One Marker.** The blaze is the only bullet, step and metric marker. Don't add icon tiles, glyph bullets or second marker shapes.

## Typography

Overpass (from the Highway Gothic signage lineage) sets every heading at weight 800. Public Sans (the US Web Design System face) sets all text. Both are self-hosted variable fonts in `assets/fonts/`.

### Hierarchy
- Display: hero H1, `clamp(2.5rem,5.8vw,4.6rem)`, line-height 1.0.
- Page H1: `clamp(2.1rem,4.6vw,3.4rem)`.
- Headline (H2): `clamp(1.85rem,3.6vw,2.7rem)`.
- Title (H3): 1.3–1.6rem.
- Body: 17px/1.6. Lede: up to 1.2rem in `ink-2`.
- Meta (kinds, hints): 15px `ink-3`, placed under the heading, never above it.

### Named Rules
- **No Eyebrows.** No label sits above a heading. Context goes beneath the name or into the sentence.
- Numerals are tabular site-wide.

## Layout

Max width 1160px with a fluid gutter (`clamp(16px,5vw,48px)`). Sections breathe at `clamp(64px,9vw,120px)` and alternate between `ground` and `land`. Lists are ruled, not boxed: entries, results, builds and pains all sit between 1px `rule` lines. Logs (results, builds) open with a 2px ink rule. On desktop, two-column splits put the heading on the left (sticky beside the trail) and the content on the right.

## Elevation & Depth

The site is flat. The only shadow is the hero's start box, which lifts off the board with a soft, offset shadow. Boards get no bevel or emboss: honest flat paint, no imitation wood.

## Shapes

Boards and the form card use 10px "sign" corners. Everything else (buttons, inputs, chips) uses a 3px radius. Blazes are 2:5 rectangles with 1.5–2px corners.

## Components

### Buttons
Primary is pine with white text on the light ground, and routed with board-coloured text on a board. Ghost buttons have a 1.5px `rule-strong` border. Minimum height is 48px. Press feedback is `scale(.97)` over 160ms with a strong ease-out. Hover is a colour change only, gated behind `(hover:hover) and (pointer:fine)`. The arrow nudges 3px on hover.

### Cards / Containers
There are no card grids. Use ruled lists (`.entries`, `.log`, `.builds`) instead. The compare block is the one exception: two bordered columns, with the winning one framed in 1.5px pine on paper.

### Inputs / Fields
Fields have a `ground` fill, a 1.5px `rule-strong` border and a minimum height of 48px. On focus they turn pine with a 3px soft ring. When invalid they turn rose (even while focused), with a rose message directly under the field linked via `aria-describedby`.

### Navigation
The nav is a sticky light bar. The current page gets a 2.5px blaze underline on desktop and bold weight in the mobile menu. The mobile menu fades and slides 8px on the drawer curve (240ms) and closes on Escape.

### Destination sign (signature)
This is the home hero's bottom row: blaze + destination name + short description + arrow, ruled in `routed` at 16% alpha. It works as a trailhead post that is also the site's main wayfinding.

### Trail (signature)
The steps are an ordered list on a dashed, blaze-tinted line with a blaze at each stop. It draws once when it scrolls into view (1.1s line on ease-in-out, stops fading in on ease-out at 0.05s / 0.42s / 0.8s). It is visible by default; JS opts in; under reduced motion it is static.

### Closing board
Every page ends with one: a blaze-led H2, the copy, a routed rule, then an arrowed primary action.

## Do's and Don'ts

### Do:
- Start the enquiry in place (the hero start box hands its text to `/contact/?problem=`).
- Keep motion to the trail draw plus small, fast feedback (100–260ms, custom ease-out curves).
- Respect `prefers-reduced-motion`: keep fades and colour, drop travel.

### Don't:
- Don't use eyebrows or kickers, icon tiles, glyph bullets, glow, gradient text, grid backgrounds or monospace as decoration.
- Don't use coloured side stripes on list items, callouts or menu items.
- Don't fill content cards with the board.
- Don't use scroll-reveal entrances on sections.
