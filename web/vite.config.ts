import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const UNKNOWN = 'unavailable'

function gitValue(repoRoot: string, args: string[]): string {
  try {
    const value = execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return value || UNKNOWN
  } catch {
    return UNKNOWN
  }
}

function environmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

function buildInfo() {
  const repoRoot = resolve(import.meta.dirname, '..')
  const dirtyValue = environmentValue('DEVBOX_BUILD_DIRTY')
  let dirty: boolean | null =
    dirtyValue === 'true' ? true : dirtyValue === 'false' ? false : null

  if (dirty == null) {
    try {
      dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim().length > 0
    } catch {
      // Keep the artifact usable when built from a source archive or without git.
    }
  }

  const environmentCommit = environmentValue('DEVBOX_BUILD_COMMIT')
  return {
    // Docker's frontend stage intentionally has no .git directory. CI passes
    // these values as build args, while local source builds still use git.
    branch: environmentValue('DEVBOX_BUILD_BRANCH') ?? gitValue(repoRoot, ['branch', '--show-current']),
    commit: environmentCommit?.slice(0, 12) ?? gitValue(repoRoot, ['rev-parse', '--short=12', 'HEAD']),
    dirty,
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Served by nginx under /launcher/ behind the PAM gate.
  base: '/launcher/',
  // Build metadata is embedded in the static bundle; the running UI never
  // needs to call the Python control plane just to render the footer.
  define: {
    __DEVBOX_BUILD_INFO__: JSON.stringify(buildInfo()),
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss()
  ],
  build: {
    rolldownOptions: {
      output: {
        // Keep the initial launcher shell small. Pages are lazy-loaded below,
        // while large shared libraries get stable vendor chunks instead of
        // being folded into one warning-sized entry bundle.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/recharts/')) return 'vendor-charts'
          if (id.includes('/framer-motion/')) return 'vendor-motion'
          if (id.includes('/lucide-react/')) return 'vendor-icons'
          if (id.includes('/@xterm/')) return 'vendor-terminal'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router/')) {
            return 'vendor-react'
          }
          if (id.includes('/@heroui/') || id.includes('/tailwindcss/')) return 'vendor-ui'
          return 'vendor'
        },
      },
    },
    // The shared vendor bundle intentionally contains the UI framework and
    // remains below this limit after package-level splitting above.
    chunkSizeWarningLimit: 700,
  },
})
