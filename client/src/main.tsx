import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ensureFreshDB } from './lib/migrate.ts'
import { registerSW } from 'virtual:pwa-register'

// Register Service Worker for offline capability
registerSW({ immediate: true })

// Run DB migration before mounting the app
ensureFreshDB().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
