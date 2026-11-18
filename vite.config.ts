import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { consoleMockPlugin } from './console-mock.vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), consoleMockPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
