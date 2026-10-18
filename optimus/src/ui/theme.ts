/**
 * Optimus design tokens (see .claude/skills/optimus-design/SKILL.md).
 * True black for OLED, white for information, red only as a signal.
 * Dark mode only.
 *
 * Contrast on bg: text 19.3:1, textSecondary 8.2:1, redGlow 6.0:1 (used for
 * small red text), red 4.5:1, white on red 4.7:1. textTertiary (3.2:1) is
 * only for hints, disabled states and timestamps.
 */

export interface Palette {
  bg: string;
  surface: string;
  surfaceRaised: string;
  line: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  red: string;
  redGlow: string;
  redDim: string;
  onRed: string;
  scrim: string;
}

export const palette: Palette = {
  bg: '#000000',
  surface: '#0B0B0C',
  surfaceRaised: '#151517',
  line: '#26262A',
  text: '#F5F5F7',
  textSecondary: '#A1A1A6',
  textTertiary: '#5C5C63',
  red: '#E31B23',
  redGlow: '#FF3B42',
  redDim: '#5A0A0E',
  onRed: '#FFFFFF',
  scrim: 'rgba(0, 0, 0, 0.78)',
};

export const fonts = {
  displayLight: 'BarlowSemiCondensed_300Light',
  display: 'BarlowSemiCondensed_500Medium',
  displayBold: 'BarlowSemiCondensed_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
};

/** 4dp grid. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

/** Side margin for screens. */
export const GUTTER = 20;

export const radius = { sm: 4, md: 6, lg: 8 };

/** Minimum touch target. */
export const TOUCH = 48;

/** Scale: 11 / 13 / 15 / 17 / 22 / 32 / 48. Labels use ~0.12em tracking. */
export const type = {
  hero: { fontFamily: fonts.displayLight, fontSize: 48, lineHeight: 52, letterSpacing: -0.5 },
  display: { fontFamily: fonts.displayLight, fontSize: 32, lineHeight: 38, letterSpacing: -0.2 },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: 0.2 },
  heading: { fontFamily: fonts.displayBold, fontSize: 15, lineHeight: 20, letterSpacing: 1.8 },
  label: { fontFamily: fonts.display, fontSize: 11, lineHeight: 14, letterSpacing: 1.32 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 23 },
  bodyLarge: { fontFamily: fonts.body, fontSize: 17, lineHeight: 26 },
  bodyStrong: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 23 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  smallStrong: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 19 },
  mono: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 15, letterSpacing: 0.6 },
  monoLarge: { fontFamily: fonts.monoMedium, fontSize: 13, lineHeight: 18, letterSpacing: 0.6 },
} as const;

/** 150ms taps, 250–350ms panels, cubic-bezier(0.2, 0, 0, 1), no overshoot. */
export const motion = { tap: 150, panel: 300, brainBlend: 500 };
export const EASE = [0.2, 0, 0, 1] as const;
