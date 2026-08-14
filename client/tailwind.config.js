/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Chart surface and page plane, taken from the validated dark palette.
        plane: '#0d0d0d',
        surface: '#1a1a19',
        raised: '#222220',
        line: '#2c2c2a',
        axis: '#383835',
        ink: '#ffffff',
        'ink-2': '#c3c2b7',
        muted: '#898781',
        // Single categorical series slot, dark step.
        series: '#3987e5',
        // Fixed status palette. Never reused as a series color.
        good: '#0ca30c',
        warning: '#fab219',
        serious: '#ec835a',
        critical: '#d03b3b',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        card: '14px',
      },
    },
  },
  plugins: [],
};
