import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Mobile-first defaults: modern build target, no exotic plugins needed.
// Bundle-size discipline: three/r3f land in one vendor chunk for long-lived caching.
export default defineConfig({
  plugins: [react()],
  // preview: { allowedHosts: true }, // allows tunnel access for device testing
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          three: ['three', '@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
});
