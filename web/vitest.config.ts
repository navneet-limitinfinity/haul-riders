import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { extensions: ['.mjs', '.js', '.ts', '.tsx', '.json'] },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts']
  }
})
