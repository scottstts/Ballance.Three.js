import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Runtime assets live under public/game and are copied into dist by Vite.
// Ballance_bin remains read-only archaeology input and is never served.
export default defineConfig({
  plugins: [react()],
})
