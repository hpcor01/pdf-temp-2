import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    base: './', // Ensure relative paths for assets
    server: {
      // Proxy removed; fetching directly from CDN
    },
    build: {
      outDir: 'dist',
      sourcemap: false
    }
  };
});