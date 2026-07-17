import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// No StrictMode: its dev double-mount boots two full game instances (double
// asset/physics init) and races the wasm physics world teardown.
createRoot(document.getElementById('root')!).render(<App />)
