import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Note: not wrapped in <StrictMode>. StrictMode's dev-only double-invoke
// of effects conflicts with Firebase's RecaptchaVerifier, which cannot
// safely render twice into the same DOM container. StrictMode has no
// effect on production builds, so this only changes local dev behavior.
createRoot(document.getElementById('root')!).render(<App />)
