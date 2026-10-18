/**
 * Optimus design tokens (see .claude/skills/optimus-design/SKILL.md).
 * Clean white canvas, near-black ink, hairline structure, red only as a
 * live signal. Light mode only.
 *
 * Contrast on bg: text 17.8:1, textSecondary 6.5:1, redGlow 6.2:1 (used for
 * small red text), red 4.7:1, white on ink 17.8:1. textTertiary (3.2:1) is
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
  /** Solid fill for primary actions (near-black). */
  ink: string;
  onInk: string;
  red: string;
  redGlow: string;
  redDim: string;
  onRed: string;
  scrim: string;
}

export const palette: Palette = {
  bg: '#FFFFFF',
  surface: '#F5F5F6',
  surfaceRaised: '#EBEBED',
  line: '#E3E3E6',
  text: '#16181D',
  textSecondary: '#5C5E66',
  textTertiary: '#8D8F96',
  ink: '#16181D',
  onInk: '#FFFFFF',
  red: '#E31937',
  redGlow: '#C0122B',
  redDim: '#F7C9D0',
  onRed: '#FFFFFF',
  scrim: 'rgba(22, 24, 29, 0.32)',
};

export const fonts = {
  displayThin: 'Inter_200ExtraLight',
  displayLight: 'Inter_300Light',
  display: 'Inter_400Regular',
  displayBold: 'Inter_600SemiBold',
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

export const radius = { sm: 6, md: 12, lg: 16, pill: 999 };

/** Minimum touch target. */
export const TOUCH = 48;

/** Scale: 11 / 13 / 15 / 17 / 22 / 34 / 52. Thin display, wide-tracked uppercase labels. */
export const type = {
  hero: { fontFamily: fonts.displayThin, fontSize: 52, lineHeight: 58, letterSpacing: -1.2 },
  display: { fontFamily: fonts.displayLight, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 },
  title: { fontFamily: fonts.displayLight, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  heading: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18, letterSpacing: 1.6 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 14, letterSpacing: 1.8 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 23 },
  bodyLarge: { fontFamily: fonts.body, fontSize: 17, lineHeight: 26 },
  bodyStrong: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 23 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  smallStrong: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 19 },
  mono: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 15, letterSpacing: 0.8 },
  monoLarge: { fontFamily: fonts.monoMedium, fontSize: 13, lineHeight: 18, letterSpacing: 0.6 },
} as const;

/** 150ms taps, 250–350ms panels, cubic-bezier(0.2, 0, 0, 1), no overshoot. */
export const motion = { tap: 150, panel: 300, brainBlend: 500 };
export const EASE = [0.2, 0, 0, 1] as const;
