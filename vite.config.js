import { defineConfig } from 'vite';

// Relative base path ensures GitHub Pages assets load correctly
// regardless of repo name or subfolder location
export default defineConfig({
  base: './',
});
