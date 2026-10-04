import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the React app calls /api, and Vite forwards it to the Express server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5000' },
  },
});
