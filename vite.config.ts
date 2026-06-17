import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base must match the GitHub Pages repo path for correct asset URLs
export default defineConfig({
  base: '/neocad/',
  plugins: [react()],
})
