---
name: optimus-design
description: The visual design system for Optimus, a personal AI assistant phone app for the Samsung Galaxy S24 Ultra. Sleek, simple, high tech: a clean white canvas, near-black ink, hairline structure and one red signal color, in the spirit of modern aerospace and electric-car interfaces, with a living 3D neural brain (wrapped in orbit rings) as the assistant avatar. Use this skill for ANY UI work on Optimus or any request about screens, layouts, colors, fonts, buttons, animations, theming, icons, the avatar, the brain, the chat view, settings, onboarding, or making the app look sleek, premium, high tech or futuristic, even if the user does not mention design explicitly.
---

# Optimus Design System

Optimus should feel like the touchscreen of a premium electric car or a launch-control display: a bright white canvas, crisp near-black type, generous empty space, flat light-grey surfaces, and precise motion. One red accent marks anything live. Nothing decorative that does not carry information. The centerpiece is a living 3D brain that visibly works while the assistant thinks.

The owner rejected the earlier black, boxy HUD look (corner brackets, condensed type, outlined boxes) and anything blue. Do not bring those back.

Before building anything, check which stack the project uses. Apply these rules in that stack's idioms. Never change the stack to fit the design.

## 1. Core principles
1. White is the canvas. Pure white (#FFFFFF) backgrounds. Light mode only.
2. Ink carries the information. Near-black for primary text and primary buttons; secondary info steps down through neutral greys, never other colors.
3. Red is a signal, not decoration. Red only for live activity (listening, thinking, a meeting happening now), awaiting-approval status and errors. If more than about 5 percent of a screen is red, it is too much.
4. Flat and soft, not boxy. Borderless light-grey cards with 12dp corners, pill buttons, hairline dividers. No HUD corner brackets, no heavy outlines, no gradients, no emoji in UI chrome. A whisper of shadow is allowed only on the selected segment of a segmented control.
5. Motion explains state. Ease out, never bounce.
6. No borrowed branding. Never use any real company's logos, wordmarks or trademarked names.

## 2. Color tokens (src/ui/theme.ts)
bg #FFFFFF (app background)
surface #F5F5F6 (cards, sheets, input fields, secondary buttons)
surface-raised #EBEBED (pressed states, segmented track, switch track off)
line #E3E3E6 (hairline dividers, input outlines)
text #16181D (headlines, body, key values)
text-secondary #5C5E66 (labels, supporting copy) 6.5:1
text-tertiary #8D8F96 (hints, timestamps, disabled) 3.2:1, never for essential text
ink #16181D / on-ink #FFFFFF (primary buttons, switch on, active nav bar)
red #E31937 (live signals, brain activity)
red-glow #C0122B (small red text: errors, "awaiting approval")
red-dim #F7C9D0 (faint red tint, e.g. memory chips)

No blues, purples or greens anywhere, including system link, focus, selection and cursor colors (use ink). Success uses ink with a check icon. Errors use red text.

## 3. Typography
Display: Inter ExtraLight/Light (200/300), large, slightly negative tracking. Greetings and screen titles are thin and big.
Labels and small headers: Inter Medium, UPPERCASE, wide tracking (about 0.15em).
Body: Inter Regular, line height about 1.5.
Telemetry: JetBrains Mono, sparingly, for status readouts and timestamps (STATUS: READY, 9:30 AM).
Scale: 11 / 13 / 15 / 17 / 22 / 34 / 52. Max three sizes per screen.

## 4. Layout and components
Spacing on a 4dp grid (8, 16, 24, 32, 48). Side margins 20.
Cards: surface fill, no border, 12dp corners, 20dp padding, uppercase tracked label on top. Active/alert cards get a 1px red outline; cards that need attention on a grey context (confirmation drafts) are white with a hairline outline.
Primary button: solid ink pill, white label in sentence case. Secondary: surface pill, ink label. Ghost: text only.
Inputs: white with a hairline outline and 6dp corners; the chat composer is a grey pill.
Segmented control: grey track, selected item is a white pill.
Switch: grey track, ink when on, white knob.
Icon buttons: thin outline icons (1.5px stroke), 48dp touch target.
Chat: assistant messages are plain ink text on white, no bubble. User messages sit in a light-grey block, right aligned. Timestamps in mono, text-tertiary.
Bottom nav: white, hairline top border, short ink bar under the active item.
Status strip in mono: READY, LISTENING, PROCESSING, RESPONDING, with a small dot that turns red and pulses when active.
Primary controls in the bottom half for one-handed use.

## 5. Motion
150ms for taps, 250 to 350ms for panels. Easing cubic-bezier(0.2, 0, 0, 1). No overshoot.
Transitions: fade plus 8 to 16dp vertical slide.
Light haptic tick on primary actions and when the assistant starts responding.
Respect reduce motion: slow the brain and drop ripples and pulses.

## 6. The avatar
The assistant is a 3D brain of ink points and hairline connections on white, wrapped in thin orbit rings like a gyroscope. Read references/brain-avatar.md before building or changing it.
Idle: slow rotation, gentle breathing and a faint surface ripple, rings drift.
Listening: turns toward you, brightens and ripples with mic volume.
Thinking: the whole brain works: faster spin, the surface ripples, a red activity band scans the cortex, clusters flash, red pulses race along connections, rings spin up, the red core throbs.
Responding: pulses radiate from the core with the words, then settles to idle.

## 7. Checklist before any screen is done
White background. Ink for structure, red only for signals. No blue, green or purple. No HUD brackets or heavy outlines. Thin large display type, tracked uppercase labels, mono only for telemetry. One-handed reach. Edge to edge with insets. Every animation reflects a real state. Reduce motion respected. No real brand names or logos. Smooth at 60fps or better with the brain running.
