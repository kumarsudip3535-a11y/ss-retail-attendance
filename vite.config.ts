import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Turns the built app into an installable PWA (manifest + service
    // worker) — the prerequisite for both "Add to Home Screen" and for
    // PWABuilder to package a real, installable Android .apk from the
    // deployed site. registerType: 'autoUpdate' means a returning user
    // silently gets the newest deployed build on next load/refresh,
    // rather than being stuck on a stale cached version.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'SS Retail Services — Attendance',
        short_name: 'SSRS Attendance',
        description: 'Employee attendance, live tracking, and travel claims for SS Retail Services.',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#4f46e5',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // GPS tracking (Phase T3+) and offline attendance queueing already
        // have their own IndexedDB-based offline logic (offlineQueueDb.ts)
        // — this only precaches the static app shell (JS/CSS/HTML/icons)
        // so the app *opens* offline, not the live Firestore data itself.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: true,
  },
})
