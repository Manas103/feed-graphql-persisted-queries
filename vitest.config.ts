import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
  },
});
