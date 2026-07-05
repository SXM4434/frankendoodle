import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/index.css';
import { applyRoughDotsDeterminismPatch } from './app/lib/patchRoughDots';

// rough.js dots filler determinism (issue #211) — must run before any
// rough.svg() rendering. See patchRoughDots.ts for why runtime > vendoring.
applyRoughDotsDeterminismPatch();

createRoot(document.getElementById('root')!).render(<App />);
