# Neural Brain Avatar

An original design: a brain shaped cloud of glowing points joined by thin lines, red and white on black. It should read as a mind at work, sleek and technical, never cartoonish or fleshy.

## Geometry (procedural, no model files)
1. Two ellipsoid hemispheres (radii about 1.0 x 0.8 x 1.2) with a small gap down the middle.
2. Displace surface points with low frequency 3D simplex or Perlin noise for cortex folds.
3. 1,500 to 3,000 surface points plus 200 to 400 inside. Fewer in battery saver.
4. Link each point to its 2 or 3 nearest neighbors within a distance limit. These edges are the paths pulses travel.
5. A small bright red core in the center representing attention.
Points are red-dim at rest, rising to red and red-glow when active. About 5 percent of points are white for sparkle. Lines at opacity 0.08 to 0.15 until a pulse passes. Use additive blending, plus soft bloom if supported.

## States
Driven by one state value plus micLevel (0 to 1) and speechLevel (0 to 1).
IDLE: rotate 6 deg/s on Y with slight tilt wobble. Brightness breathes 0.3 to 0.45 over 4.5s. Lines nearly invisible. Core faint.
LISTENING: rotation slows, brain turns slightly toward camera. Shell brightness = 0.4 + micLevel * 0.6. Core medium.
THINKING: rotation 25 deg/s. Random clusters flash. 6 to 12 pulses per second travel along random edges with short fading trails. Core bright and pulsing.
RESPONDING: medium rotation. Glow = 0.5 + speechLevel * 0.5. Pulses radiate outward from core with the words.
Blend all values between states over 400 to 600ms. Never snap.
micLevel comes from smoothed recorder or recognizer amplitude. speechLevel comes from TTS amplitude, or pulse per streamed text chunk if unavailable. THINKING runs from request sent until first response token.

## Interaction
Drag to rotate slightly, then ease back to auto rotation. Tap to start listening. Long press opens assistant settings.

## Layout
Home: brain centered in upper half, 60 to 70 percent of screen width, thin HUD corner brackets, status strip above.
Chat: small 48 to 64dp live brain in the top bar, still reacting to state.

## Implementation by stack
Keep geometry and the state machine in plain code separate from rendering.
Jetpack Compose: draw on Canvas with manual 3D rotation and perspective projection, depth sorted, farther points smaller and dimmer, frames via withFrameNanos. For GPU 3D with bloom use Filament, SceneView, or OpenGL ES with point sprites and additive blending.
React Native: @react-three/fiber with expo-gl (Points, LineSegments, additive blending), or @shopify/react-native-skia with the Canvas approach.
Flutter: CustomPainter with manual projection driven by a Ticker. FragmentProgram shaders for glow.
Web or WebView: Three.js with Points, LineSegments, AdditiveBlending and UnrealBloomPass.

## Performance
Target 60fps, 120fps in high refresh mode. Precompute geometry once. Pause when backgrounded or off screen. Battery saver: half the points, no bloom, 30fps cap. Reduce motion: rotation 75 percent slower, keep color changes, no traveling pulses.
