import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      // Font sizes bound to the theme tokens in src/styles.css. Use these
      // (`text-11`, `text-caption`, ...) instead of `text-[var(--text-11)]`:
      // Tailwind cannot tell whether an arbitrary `var()` is a size or a
      // color and silently emits a `color:` rule for it.
      fontSize: {
        8: 'var(--text-8)',
        9: 'var(--text-9)',
        10: 'var(--text-10)',
        '10-5': 'var(--text-10-5)',
        11: 'var(--text-11)',
        '11-5': 'var(--text-11-5)',
        12: 'var(--text-12)',
        '12-5': 'var(--text-12-5)',
        13: 'var(--text-13)',
        14: 'var(--text-14)',
        micro: 'var(--type-micro)',
        caption: 'var(--type-caption)',
        compact: 'var(--type-compact)',
        ui: 'var(--type-ui)',
        prose: 'var(--type-prose)',
        chat: 'var(--chat-text-size)',
        'chat-question': 'var(--chat-question-size)',
        document: 'var(--document-text-size)',
        'sidebar-item': 'var(--sidebar-item-size)',
        'sidebar-item-compact': 'var(--sidebar-item-compact-size)',
        'sidebar-item-comfortable': 'var(--sidebar-item-comfortable-size)',
        'sidebar-drone': 'var(--sidebar-drone-size)',
        'sidebar-drone-compact': 'var(--sidebar-drone-compact-size)',
        'sidebar-drone-comfortable': 'var(--sidebar-drone-comfortable-size)'
      }
    }
  },
  plugins: []
} satisfies Config;
