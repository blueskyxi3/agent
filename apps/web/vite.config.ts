import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/mount.tsx',
      formats: ['es'],
      fileName: () => 'assistant-embed.js'
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => (assetInfo.name?.endsWith('.css') ? 'assistant.css' : 'assets/[name]-[hash][extname]')
      }
    }
  }
});
