/**
 * REGENT tokens. Colours are CSS variables holding RGB channels (styles.css),
 * so `bg-copper/15` composes alpha correctly and the light theme swaps every
 * token at once. Colour carries state, never decoration:
 *
 *   copper   authority, the primary action, the current selection
 *   crimson  a violated invariant (and only that)
 *   sage     a verified invariant
 *   amber    incomplete evidence, warnings
 *   fog      unknown: evidence that cannot settle the question
 */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: v('canvas'),
        s1: v('s1'),
        s2: v('s2'),
        s3: v('s3'),
        s4: v('s4'),
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3'), 4: v('ink-4') },
        line: { DEFAULT: v('line'), strong: v('line-strong') },
        copper: { DEFAULT: v('copper'), ink: v('copper-ink') },
        crimson: { DEFAULT: v('crimson'), ink: v('crimson-ink') },
        sage: { DEFAULT: v('sage'), ink: v('sage-ink') },
        amber: { DEFAULT: v('amber'), ink: v('amber-ink') },
        fog: { DEFAULT: v('fog'), ink: v('fog-ink') },
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      // Steps the design uses for hairline tints; Tailwind ships only multiples of 5.
      opacity: { 3: '0.03', 7: '0.07', 8: '0.08', 12: '0.12', 14: '0.14', 16: '0.16', 18: '0.18', 22: '0.22', 26: '0.26', 28: '0.28', 32: '0.32', 35: '0.35', 45: '0.45', 55: '0.55', 65: '0.65' },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: { DEFAULT: '4px', md: '6px', lg: '8px' },
      boxShadow: {
        lift: '0 1px 0 rgb(var(--ink) / 0.04) inset, 0 12px 32px -16px rgb(0 0 0 / 0.6)',
        glow: '0 0 0 1px rgb(var(--copper) / 0.45), 0 0 24px -6px rgb(var(--copper) / 0.45)',
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    },
  },
  plugins: [],
}
