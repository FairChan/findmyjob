import { defineConfig } from '@playwright/test'

// Same as playwright.config.ts in this folder, but for the redesign worktree's preview
// server on port 3010. Does not start a server: run the preview first.
export default defineConfig({
  testDir: '.',
  testMatch: 'home-recruiter-rail.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '../../test-results/recruiter-rail',
  use: {
    // localhost, not 127.0.0.1: Next dev refuses its own scripts to a different origin.
    baseURL: 'http://localhost:3010',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
})
