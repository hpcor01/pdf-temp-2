import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    base: './', // Ensure relative paths for assets
    server: {
      proxy: {
        // Local proxy to bypass CORS during development
        '/imgly-proxy': {
          target: 'https://unpkg.com/@imgly/background-removal-data@1.7.0/dist',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/imgly-proxy/, ''),
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false
    }
  };
});