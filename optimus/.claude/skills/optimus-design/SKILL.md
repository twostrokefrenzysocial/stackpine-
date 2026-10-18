---
name: optimus-design
description: The visual design system for Optimus, a personal AI assistant phone app for the Samsung Galaxy S24 Ultra. Black, white and red, aerospace and electric-car inspired, minimal and futuristic, with an animated 3D neural brain as the assistant avatar. Use this skill for ANY UI work on Optimus or any request about screens, layouts, colors, fonts, buttons, animations, theming, icons, the avatar, the brain, the chat view, settings, onboarding, or making the app look sleek, premium, high tech or futuristic, even if the user does not mention design explicitly.
---

# Optimus Design System

Optimus should feel like the cockpit display of a spacecraft or a premium electric car: pure black, crisp white type, one confident red accent, generous empty space, and precise motion. Nothing decorative that does not carry information. The centerpiece is a living 3D brain that shows what the assistant is doing.

Before building anything, check which stack the project uses. Apply these rules in that stack's idioms. Never change the stack to fit the design.

## 1. Core principles
1. Black is the canvas. True black (#000000) backgrounds for the OLED screen.
2. Red is a signal, not decoration. Red only for active state, primary action, live activity (listening, thinking), and alerts. If more than about 5 percent of a screen is red, it is too much.
3. White carries the information. Secondary info steps down through grays, never other colors.
4. Restraint beats ornament. No large gradients, no drop shadows, no bubbly shapes, no emoji in UI chrome. Thin lines, sharp or slightly rounded corners, lots of space.
5. Motion explains state. Ease out, never bounce.
6. No borrowed branding. Never use any real company's logos, wordmarks or trademarked names.

## 2. Color tokens
bg #000000 (app background)
surface #0B0B0C (cards, sheets, input field)
surface-raised #151517 (pressed states, menus)
line #26262A (hairline dividers and outlines)
text-primary #F5F5F7 (headlines, body, key values)
text-secondary #A1A1A6 (labels, timestamps)
text-tertiary #5C5C63 (hints, disabled)
red #E31B23 (primary actions, active state, brain activity)
red-glow #FF3B42 (brightest core of glows and firing synapses only)
red-dim #5A0A0E (idle neural tissue, inactive tracks)

No blues, purples or greens anywhere, including system default link and focus colors. Success uses white with a check icon. Errors use red with text. Dark mode only.

## 3. Typography
Display and labels: Barlow, Barlow Semi Condensed, or Space Grotesk. UPPERCASE with about 0.12em letter spacing for small labels, headers and buttons.
Body: Inter, line height about 1.5.
Telemetry and data: JetBrains Mono for numbers, status readouts and timestamps (STATUS: ONLINE, LATENCY 240 MS).
Scale: 11 / 13 / 15 / 17 / 22 / 32 / 48. Large greetings can be weight 300. Max three sizes per screen.

## 4. Layout and components
Spacing on a 4dp grid (8, 16, 24, 32, 48). Side margins 20 to 24.
Corners 4 to 8. Pills only for small status chips.
Edge to edge with safe insets. Primary controls in the bottom half for one-handed use.
Primary button: solid red, white uppercase label, no shadow.
Secondary button: transparent, 1px line border, white label.
Icon buttons: thin outline icons (1.5px stroke), 48dp touch target.
Chat: assistant messages are plain white text on black with no bubble, left aligned. User messages sit in a surface block, right aligned, with a 2px red bar on the left. Timestamps in monospace, text-tertiary.
Input bar pinned to bottom, surface background, hairline top border. Mic button turns solid red while listening.
Status strip near the top in monospace: READY, LISTENING, PROCESSING, RESPONDING, with a small red dot that pulses when active.
HUD details (corner brackets, tick marks) sparingly, one or two per screen.

## 5. Motion
150ms for taps, 250 to 350ms for panels. Easing cubic-bezier(0.2, 0, 0, 1). No overshoot.
Transitions: fade plus 8 to 16dp vertical slide.
Light haptic tick on primary actions and when the assistant starts responding.
Respect reduce motion: slow the brain and drop particle effects.

## 6. The avatar
The assistant is a 3D brain of glowing points and connections on black. Read references/brain-avatar.md before building or changing it.
Idle: slow rotation, dim red points, gentle breathing glow.
Listening: brightens with mic volume.
Thinking: faster rotation, red pulses race along connections, core brightens.
Responding: glow pulses with speech, then settles to idle.

## 7. Checklist before any screen is done
True black background. Red only for signals. No blue, green or purple. Uppercase spaced labels and monospace data. One-handed reach. Edge to edge with insets. Every animation reflects a real state. Reduce motion respected. No real brand names or logos. Smooth at 60fps or better with the brain running.
