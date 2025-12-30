/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    screens: {
      'xs': '475px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
      '3xl': '1920px',
    },
    extend: {
      colors: {
        // CoreEdge.io Brand Colors - Professional Enterprise Theme
        primary: {
          50: '#f0f4ff',
          100: '#e0e9ff',
          200: '#c7d5ff',
          300: '#a5b8ff',
          400: '#7c8fff',
          500: '#5b6cff', // Primary brand color
          600: '#4a56e8',
          700: '#3d45d1',
          800: '#3439a9',
          900: '#323887',
          950: '#1e2050',
        },
        secondary: {
          50: '#f5f7fa',
          100: '#e9ecf1',
          200: '#d3d9e3',
          300: '#b2bfd0',
          400: '#8a9db5',
          500: '#6b7f9d',
          600: '#556686',
          700: '#45536d',
          800: '#3c475b',
          900: '#353d4e',
          950: '#242830',
        },
        accent: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        success: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #5b6cff 0%, #4a56e8 50%, #3d45d1 100%)',
        'gradient-secondary': 'linear-gradient(135deg, #6b7f9d 0%, #556686 50%, #45536d 100%)',
        'gradient-hero': 'linear-gradient(135deg, #5b6cff 0%, #7c8fff 50%, #a5b8ff 100%)',
      },
      boxShadow: {
        'brand': '0 4px 6px -1px rgba(91, 108, 255, 0.1), 0 2px 4px -1px rgba(91, 108, 255, 0.06)',
        'brand-lg': '0 10px 15px -3px rgba(91, 108, 255, 0.1), 0 4px 6px -2px rgba(91, 108, 255, 0.05)',
        'brand-xl': '0 20px 25px -5px rgba(91, 108, 255, 0.1), 0 8px 10px -6px rgba(91, 108, 255, 0.05)',
        'elevation-1': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
        'elevation-2': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
        'elevation-3': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
        'elevation-4': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

