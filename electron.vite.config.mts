import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'

const mainEnv = loadEnv('production', process.cwd(), ['MAIN_VITE_'])

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: Object.fromEntries(
      Object.entries(mainEnv).map(([k, v]) => [`process.env.${k}`, JSON.stringify(v)])
    ),
    build: {
      rollupOptions: {
        // The accounting worker is a second entry emitted beside the main one,
        // so `new Worker(join(__dirname, 'accounting-worker.js'))` resolves in
        // development and in a packaged app alike.
        input: {
          index: resolve('src/main/index.ts'),
          'accounting-worker': resolve('src/main/services/accounting/worker-entry.ts'),
        },
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@preload': resolve('src/preload'),
        '@': resolve('src/renderer/src'),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      // Generate bundle/stats.html when ANALYZE=true pnpm build
      ...(process.env['ANALYZE'] === 'true'
        ? [visualizer({ filename: 'bundle/stats.html', open: true, gzipSize: true })]
        : []),
    ],
  },
})
