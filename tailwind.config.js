/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta institucional verde/tierra/agua
        forest: { DEFAULT: '#15803d', dark: '#14532d', light: '#22c55e' },
        earth: { DEFAULT: '#b45309', dark: '#78350f' },
        water: { DEFAULT: '#0e7490', dark: '#155e75' },
        ink: '#0f172a',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
