import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built site works from a sub-path as well as a
  // domain root — GitHub Pages and most shared hosting serve from a sub-path.
  base: './',
  build: {
    outDir: 'dist',
    // The catalogue is the bulk of the payload and changes on every price
    // update; keeping it in its own chunk lets the rest stay cached.
    rollupOptions: {
      output: {
        manualChunks: {
          catalogue: ['./src/data/catalogue.json'],
        },
      },
    },
  },
});
