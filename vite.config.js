import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020'
  },
  server: { fs: { allow: ['..'] } }
});
