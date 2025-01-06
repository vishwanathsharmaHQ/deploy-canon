import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: true
  },
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify('https://deploy-canon-api.vercel.app/api'),
    'import.meta.env.VITE_IPFS_GATEWAY_URL': JSON.stringify('https://cloudflare-ipfs.com/ipfs'),
    'import.meta.env.VITE_IPFS_API_URL': JSON.stringify('https://ipfs.infura.io:5001')
  }
})
