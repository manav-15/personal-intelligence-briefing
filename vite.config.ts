import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Let the Worker enforce API origin and OPTIONS policy during local development.
  server: { cors: false },
  plugins: [react(), cloudflare()],
});
