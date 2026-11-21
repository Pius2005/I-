/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Charcoal black scale for primary brand & actions
        forest: {
          50: '#f4f4f5',
          100: '#e4e4e7',
          200: '#d4d4d8',
          300: '#a1a1aa',
          400: '#71717a',
          500: '#3f3f46',
          600: '#18181b', // primary charcoal black
          700: '#121214', // dark charcoal hover
          800: '#09090b', // hero / dark card charcoal
          900: '#000000', // pure black
          950: '#000000', // deepest black (used in a few places)
        },
        // Monochromatic accents for former gold tags/badges
        gold: {
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#18181b',
          600: '#27272a',
          700: '#18181b',
          800: '#09090b',
          900: '#000000',
        },
        cream: '#fafafa', // clean modern off-white background
        ink: '#09090b', // rich charcoal black text
        muted: '#71717a', // clean neutral zinc text
        line: '#e4e4e7', // crisp neutral border
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['Inter', 'Noto Sans', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.04), 0 8px 24px -12px rgba(0,0,0,0.08)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'none' } },
      },
      animation: { 'fade-in': 'fade-in 180ms ease-out' },
    },
  },
  plugins: [],
};
