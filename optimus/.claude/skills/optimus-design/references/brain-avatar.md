# Neural Brain Avatar

An original design: a brain-shaped cloud of ink points joined by hairlines on a white canvas, wrapped in thin orbit rings, with red reserved for activity. It should read as a mind at work, sleek and technical, like an instrument rather than a creature. Never cartoonish, fleshy or blue.

## Geometry (procedural, no model files) — src/core/brain/geometry.ts
1. Two ellipsoid hemispheres (radii about 1.0 x 0.8 x 1.2) with a small gap down the middle.
2. Displace surface points with low frequency 3D Perlin noise for cortex folds.
3. 1,500 to 3,000 surface points plus 200 to 400 inside. Fewer in battery saver.
4. Link each point to its 2 or 3 nearest neighbors within a distance limit. These edges are the paths pulses travel.
5. A small red core in the center representing attention, with a soft halo.
6. Three orbit rings (radii about 1.4 to 1.55) at different tilts: one dashed, one solid, one with tick marks; a red marker rides the dashed ring. Rings follow the camera tilt but spin on their own; the half nearer the camera is darker.
Points are ink, farther points smaller and lighter (depth bins about 0.16 / 0.38 / 0.8 opacity). About 5 percent of points are red accents. Lines at opacity 0.06 to 0.16. Normal (source-over) blending; additive blending disappears on white.

## Motion: it moves as it thinks
Every point is pushed along its radius by two travelling sine waves (a ripple), so the surface visibly breathes and churns. Amplitude and speed are state parameters.

## States — src/core/brain/state.ts
Driven by one state value plus micLevel (0 to 1) and speechLevel (0 to 1).
IDLE: rotate 6 deg/s with slight tilt wobble. Brightness breathes 0.45 to 0.60 over 4.5s. Small slow ripple. Rings drift. An occasional pulse. Core faint.
LISTENING: rotation slows, brain turns slightly toward camera. Brightness = 0.55 + micLevel * 0.45; ripple and outward pulses grow with micLevel.
THINKING: rotation 22 deg/s. Strong fast ripple. A red activity band sweeps front to back through the cortex. Random clusters flash red. About 12 pulses per second travel along random edges with short red trails. Rings spin up. Core bright and throbbing.
RESPONDING: medium rotation. Brightness = 0.6 + speechLevel * 0.4. Pulses radiate outward from the core with the words.
Blend all values between states over about 500ms. Never snap.
micLevel comes from smoothed recognizer amplitude. speechLevel comes from TTS amplitude, or a pulse per streamed text chunk. THINKING runs from request sent until the first response token.

## Interaction
Drag to rotate, then ease back to auto rotation. Tap to talk. Long press opens assistant settings.

## Layout
Home: brain centered near the top, nearly full width (up to 400dp), status strip just below, no frame around it.
Chat: small 48 to 64dp live brain in the top bar, still reacting to state (rings and edges hidden at that size).

## Implementation (React Native)
@shopify/react-native-skia: record a Picture each frame in a Reanimated derived value; projection, ripple and pulses run on the UI thread from a frame callback. Geometry and the state machine stay in plain TypeScript, separate from rendering, and are unit tested.

## Performance
Target 60fps, 120fps in high refresh mode. Precompute geometry once. Pause when backgrounded or off screen. Battery saver: half the points, no halo blur, 30fps cap. Reduce motion: rotation and rings 75 percent slower, keep color changes, no ripple, no travelling pulses.
