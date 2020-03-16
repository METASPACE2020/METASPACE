const defaults = require('tailwindcss/defaultConfig.js')

module.exports = {
  // Reference: https://tailwindcss.com/docs/configuration
  // Defaults: https://github.com/tailwindcss/tailwindcss/blob/master/stubs/defaultConfig.stub.js
  theme: {
    fontFamily: {
      sans: ['Roboto', 'SUPERSCIPT_OVERRIDE', 'Helvetica', 'sans-serif'],
    },
    placeholderColor: {
      default: theme => theme('colors.gray.600')
    },
    extend: {
      colors: {
        body: 'hsl(208, 61%, 16%)',
        gray: { // greys based on brand colour
          '100': 'hsl(208, 36%, 96%)',
          '200': 'hsl(208, 33%, 89%)',
          '300': 'hsl(208, 31%, 80%)',
          '400': 'hsl(208, 27%, 70%)',
          '500': 'hsl(208, 23%, 60%)',
          '600': 'hsl(208, 22%, 49%)',
          '700': 'hsl(208, 28%, 39%)',
          '800': 'hsl(208, 34%, 30%)',
          '900': 'hsl(208, 39%, 23%)',
        },
        blue: {
          '100': 'hsl(208, 79%, 92%)',
          '200': 'hsl(208, 97%, 85%)',
          '300': 'hsl(208, 84%, 74%)',
          '400': 'hsl(208, 74%, 65%)',
          '500': 'hsl(208, 65%, 55%)',
          '600': 'hsl(208, 67%, 45%)',
          '700': 'hsl(208, 76%, 39%)',
          '800': 'hsl(208, 82%, 33%)',
          '900': 'hsl(208, 87%, 29%)',
          '999': 'hsl(208, 100%, 21%)',
        }
      },
      inset: {
        '1/2': '50%',
      },
      opacity: {
        '1': '0.01',
      },
      spacing: {
        auto: 'auto',
      },
      maxWidth: {
        'measure-1': '44ch',
        'measure-2': '52ch',
        'measure-3': '60ch',
        'measure-4': '68ch',
        'measure-5': '76ch',
      },
      zIndex: {
        '-10': '-10', // Use .-z-10 not .z--10
        '-20': '-20',
      },
    }
  },
  variants: {
    borderColor: [...defaults.variants.borderColor, 'focus-within'],
    margin: [...defaults.variants.margin, 'last'],
  },
  plugins: [],
  corePlugins: {
    // Disable preflight, as it actively removes parts of the browser stylesheet that existing code relies on,
    // e.g. increased font size & weight on h1, h2, etc. elements.
    // More info: https://tailwindcss.com/docs/preflight/#app
    preflight: false,
  }
}
