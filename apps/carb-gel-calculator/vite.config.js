import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/financial-calculators/carb-gel-calculator/',
  plugins: [react()],
})
