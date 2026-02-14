import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3051,
    proxy: {
      '/api': 'http://localhost:3050',
      '/ws': {
        target: 'ws://localhost:3050',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
