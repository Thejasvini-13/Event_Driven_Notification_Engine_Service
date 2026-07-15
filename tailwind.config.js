/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        surface: {
          DEFAULT: '#0f0f23',
          card:    '#16162a',
          hover:   '#1e1e38',
          border:  '#2a2a4a',
        },
        brand: {
          purple:  '#7c3aed',
          violet:  '#8b5cf6',
          indigo:  '#6366f1',
          cyan:    '#06b6d4',
          emerald: '#10b981',
        },
        status: {
          created:   '#64748b',
          enriched:  '#3b82f6',
          routed:    '#8b5cf6',
          queued:    '#f59e0b',
          sent:      '#06b6d4',
          delivered: '#10b981',
          read:      '#22c55e',
          failed:    '#ef4444',
          dead:      '#dc2626',
        },
      },
      backgroundImage: {
        'gradient-radial':  'radial-gradient(var(--tw-gradient-stops))',
        'mesh-gradient':    'linear-gradient(135deg, #0f0f23 0%, #1a0533 50%, #0a1628 100%)',
        'card-gradient':    'linear-gradient(135deg, rgba(124,58,237,0.1) 0%, rgba(99,102,241,0.05) 100%)',
        'glow-purple':      'radial-gradient(circle at center, rgba(124,58,237,0.15) 0%, transparent 70%)',
      },
      animation: {
        'pulse-slow':   'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-in':     'slideIn 0.3s ease-out',
        'fade-in':      'fadeIn 0.4s ease-out',
        'bounce-in':    'bounceIn 0.5s ease-out',
        'shimmer':      'shimmer 2s linear infinite',
      },
      keyframes: {
        slideIn: {
          '0%':   { transform: 'translateY(-8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        bounceIn: {
          '0%':   { transform: 'scale(0.9)', opacity: '0' },
          '60%':  { transform: 'scale(1.02)' },
          '100%': { transform: 'scale(1)',   opacity: '1' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      boxShadow: {
        'glow-purple': '0 0 20px rgba(124, 58, 237, 0.3)',
        'glow-cyan':   '0 0 20px rgba(6, 182, 212, 0.3)',
        'card':        '0 4px 24px rgba(0, 0, 0, 0.4)',
        'card-hover':  '0 8px 40px rgba(0, 0, 0, 0.5)',
      },
    },
  },
  plugins: [],
};
