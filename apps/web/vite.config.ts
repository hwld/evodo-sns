import { defineConfig } from 'vitest/config'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

// vitest と tanstackStart() / cloudflare() の plugin が衝突するため test 時は外す。
// https://github.com/TanStack/router/issues/6246 が解決したら無条件 enable に戻す。
const isTest = process.env.VITEST === 'true'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    !isTest && cloudflare({ viteEnvironment: { name: 'ssr' }, inspectorPort: 9230 }),
    tailwindcss(),
    !isTest && tanstackStart(),
    viteReact(),
  ],
  test: {
    environment: 'jsdom',
  },
})

export default config
