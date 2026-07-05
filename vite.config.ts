import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
    // CRITICAL (2026-06-13): force a SINGLE React copy. Concurrent agent Vite
    // servers symlink this node_modules and share node_modules/.vite, which
    // corrupted the optimized-deps cache → "Invalid hook call / more than one
    // copy of React / null useState" → blank page on every route. dedupe makes
    // every instance resolve the one on-disk react@18, so a shared/again-stale
    // cache can't produce a second copy. (Agent servers should ALSO pass their
    // own --cacheDir; this is the belt-and-suspenders.)
    //
    // CRITICAL (2026-06-15): force a SINGLE three copy too. `stats-gl` (a
    // transitive dep of @react-three/drei) pulls three@0.170 while the rest of
    // the stack is on three@0.169 — TWO physical copies on disk. Locally it's
    // dormant (we never import drei's Perf/stats-gl, so 0.170 stays out of the
    // graph), but Make's optimized-deps bundle pulled both in → react-three-fiber's
    // `instanceof THREE.*` identity checks failed → applyProps resolved a pierced
    // prop against the wrong three instance and threw `Cannot read properties of
    // undefined (reading 'fg')` (fiber even documents this duplicate-three hazard).
    // dedupe collapses every `three` import (incl. stats-gl's) to the one root
    // copy; optimizeDeps.include pre-bundles the R3F stack against that single
    // three so a second copy is never inlined. (3D crashed in Make — homepage +
    // desk-3D — until this landed; clear node_modules/.vite to force re-optimize.)
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'],
  },
  optimizeDeps: {
    include: ['three', '@react-three/fiber', '@react-three/drei'],
  },
  server: {
    port: 5182,
    watch: {
      // CRITICAL (2026-06-13): the dev server was watching .claude/worktrees/**,
      // so every file a background agent wrote into a worktree fired a page
      // reload on the MAIN app → with many agents the HMR module graph tore
      // (Invalid hook call / null useState / blank page) and only a server
      // restart cleared it. Ignore the worktrees (+ build/test artifacts) so
      // agent activity never touches the live dev server again.
      ignored: [
        '**/.claude/worktrees/**',
        '**/dist/**',
        '**/audit-runs/**',
        '**/node_modules/**',
      ],
    },
  },
})
