import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './web/index.html',
    './web/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--display)'],
        sans: ['var(--sans)'],
        code: ['var(--code)'],
      },
    },
  },
  plugins: [],
} satisfies Config;
