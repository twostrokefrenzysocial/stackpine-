/**
 * Optimus design tokens: an engineered command-center look.
 * Gunmetal/graphite grounds, brushed-steel surfaces, electric cyan for
 * active/primary, amber for warnings and confirmations.
 *
 * Contrast: body text on surfaces is >= 7:1 in dark and >= 7:1 in light;
 * accent text (cyan/amber) is only used at >= 4.5:1 sizes/weights.
 */

export interface Palette {
  mode: 'dark' | 'light';
  ground: string; // screen background
  groundDeep: string; // gradient end
  surface: string; // panels
  surfaceHi: string; // raised panel / gradient top
  surfaceLo: string; // gradient bottom
  inset: string; // input wells
  seam: string; // fine panel seams
  seamHi: string; // seam highlight (bevel)
  rivet: string;
  text: string;
  textDim: string;
  textFaint: string;
  cyan: string; // primary accent
  cyanText: string; // cyan readable as text on surface
  cyanDim: string;
  cyanGlow: string;
  amber: string;
  amberText: string;
  amberDim: string;
  danger: string;
  dangerText: string;
  ok: string;
  onAccent: string; // text on cyan/amber fills
  scrim: string;
}

export const dark: Palette = {
  mode: 'dark',
  ground: '#0E1114',
  groundDeep: '#07090B',
  surface: '#1A1F24',
  surfaceHi: '#252B31',
  surfaceLo: '#151A1E',
  inset: '#0B0E11',
  seam: '#2E363E',
  seamHi: '#3A444D',
  rivet: '#4A545D',
  text: '#E8EDF1',
  textDim: '#A9B4BD',
  textFaint: '#8A96A0',
  cyan: '#22D3EE',
  cyanText: '#5CE1F5',
  cyanDim: '#0E5E6B',
  cyanGlow: 'rgba(34, 211, 238, 0.35)',
  amber: '#F5A524',
  amberText: '#FFBE4D',
  amberDim: '#6B4A12',
  danger: '#F05252',
  dangerText: '#FF8080',
  ok: '#3DDC97',
  onAccent: '#061114',
  scrim: 'rgba(4, 6, 8, 0.72)',
};

export const light: Palette = {
  mode: 'light',
  ground: '#E6EBEF',
  groundDeep: '#D5DCE2',
  surface: '#F7F9FA',
  surfaceHi: '#FFFFFF',
  surfaceLo: '#EDF1F4',
  inset: '#DCE3E8',
  seam: '#C3CDD5',
  seamHi: '#FFFFFF',
  rivet: '#A3AFB9',
  text: '#11181E',
  textDim: '#3E4B56',
  textFaint: '#5F6C77',
  cyan: '#0E7490',
  cyanText: '#0B6F88',
  cyanDim: '#B9EAF3',
  cyanGlow: 'rgba(8, 145, 178, 0.25)',
  amber: '#B45309',
  amberText: '#9A5200',
  amberDim: '#FCE3BC',
  danger: '#C81E1E',
  dangerText: '#B01818',
  ok: '#0E9F6E',
  onAccent: '#FFFFFF',
  scrim: 'rgba(17, 24, 30, 0.45)',
};

export const fonts = {
  display: 'ChakraPetch_600SemiBold',
  displayBold: 'ChakraPetch_700Bold',
  displayMedium: 'ChakraPetch_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
};

/** 4pt spacing scale. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

/** Chamfer (angled corner) sizes. */
export const chamfer = { sm: 8, md: 14, lg: 20 };

/** Minimum touch target (Android recommends 48dp). */
export const TOUCH = 52;

export const type = {
  hero: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 36, letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: 0.4 },
  heading: { fontFamily: fonts.display, fontSize: 17, lineHeight: 22, letterSpacing: 0.6 },
  label: { fontFamily: fonts.displayMedium, fontSize: 12, lineHeight: 16, letterSpacing: 1.6 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 24 },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  smallStrong: { fontFamily: fonts.bodyMedium, fontSize: 14, lineHeight: 20 },
  mono: { fontFamily: fonts.displayMedium, fontSize: 13, lineHeight: 18, letterSpacing: 0.8 },
} as const;

/** Every animation in the app stays under 400ms. */
export const motion = { fast: 160, base: 240, slow: 360 };
