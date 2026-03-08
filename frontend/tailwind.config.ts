import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:             'var(--color-bg)',
        surface:        'var(--color-surface)',
        border:         'var(--color-border)',
        'border-strong':'var(--color-border-strong)',
        accent:         'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        'accent-subtle':'var(--color-accent-subtle)',
        danger:         'var(--color-danger)',
        'danger-subtle':'var(--color-danger-subtle)',
        success:        'var(--color-success)',
        warning:        'var(--color-warning)',
      },
      textColor: {
        primary:   'var(--color-text-primary)',
        secondary: 'var(--color-text-secondary)',
        tertiary:  'var(--color-text-tertiary)',
        inverse:   'var(--color-text-inverse)',
      },
      fontFamily: {
        sans:  ['DM Mono', 'Courier New', 'monospace'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
        mono:  ['DM Mono', 'Courier New', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '16px' }],
        xs:    ['12px', { lineHeight: '16px' }],
        sm:    ['13px', { lineHeight: '20px' }],
        base:  ['14px', { lineHeight: '20px' }],
        md:    ['15px', { lineHeight: '22px' }],
        lg:    ['16px', { lineHeight: '24px' }],
        xl:    ['18px', { lineHeight: '26px' }],
        '2xl': ['22px', { lineHeight: '30px' }],
        '3xl': ['28px', { lineHeight: '36px' }],
        '4xl': ['36px', { lineHeight: '44px' }],
        '5xl': ['48px', { lineHeight: '56px' }],
        '6xl': ['64px', { lineHeight: '72px' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      transitionDuration: {
        fast: '100ms',
        base: '150ms',
        slow: '250ms',
      },
      spacing: {
        sidebar: 'var(--sidebar-width)',
        topbar:  'var(--topbar-height)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in':        'fade-in 200ms ease forwards',
        'fade-up':        'fade-up 250ms ease forwards',
        'slide-in-right': 'slide-in-right 200ms ease forwards',
      },
    },
  },
  plugins: [],
}

export default config