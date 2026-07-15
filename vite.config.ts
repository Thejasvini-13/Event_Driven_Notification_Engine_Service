import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api':     { target: 'http://localhost:3000', changeOrigin: true },
      '/metrics': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': {
        target:    'ws://localhost:3000',
        ws:        true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir:      'dist',
    sourcemap:   true,
    rollupOptions: {
      output: {
        manualChunks: {
          react:    ['react', 'react-dom'],
          recharts: ['recharts'],
          lucide:   ['lucide-react'],
        },
      },
    },
  },
});
