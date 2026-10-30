import { defineConfig } from '@playwright/test';
import local from './playwright.config.js';

export default defineConfig({
  ...local,
  testMatch: ['desktop.spec.js', 'fullscreen.spec.js', 'netlify.spec.js'],
  testIgnore: [],
  use: { ...local.use, baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'npm run build:netlify && npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
