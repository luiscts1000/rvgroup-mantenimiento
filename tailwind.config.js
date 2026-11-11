/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        // Paleta oficial del logo de RV Group Transporte (Azul corporativo + Verde hoja)
        brand: {
          50: '#eef6ff',
          100: '#d9eaff',
          200: '#bcdaff',
          300: '#8ec2ff',
          400: '#59a0ff',
          500: '#2b7bf6',
          600: '#1862db',
          700: '#14559b',
          800: '#11457d',
          900: '#0d3562',
          950: '#082140',
        },
        rvgreen: {
          50: '#f4fce8',
          100: '#e6f8cc',
          200: '#cef19e',
          300: '#aee566',
          400: '#8fd833',
          500: '#7cd100',
          600: '#62a700',
          700: '#4b8000',
          800: '#3d6505',
          900: '#345509',
        },
      },
    },
  },
  plugins: [],
};
