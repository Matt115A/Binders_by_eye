import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // relative asset paths: the build works from any URL, e.g. https://<user>.github.io/<repo>/
  base: './',
  server: { port: 5173, open: false },
});
