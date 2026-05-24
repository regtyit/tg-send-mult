import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootDir = dirname(fileURLToPath(import.meta.url));
/** Nitro writes `.output/public/` under this directory; Fastify serves that folder. */
const nitroOutDir = resolve(rootDir, '../src/apps/api/public/.nuxt-spa');

export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: '2024-11-01',
  css: ['~/assets/data-tables.css'],
  typescript: { strict: true },
  modules: ['vuetify-nuxt-module'],
  vuetify: {
    vuetifyOptions: {
      theme: {
        defaultTheme: 'dark',
        themes: {
          dark: {
            colors: {
              primary: '#34d399',
              surface: '#0f172a',
            },
          },
        },
      },
    },
  },
  nitro: {
    output: {
      dir: nitroOutDir,
    },
  },
  vite: {
    server: {
      proxy: {
        '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
        '/admin': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      },
    },
  },
});
