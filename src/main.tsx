import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
// isomorphic-git and its downstream callers expect Node's `Buffer` global.
// Browsers don't have it, so we bind a shim as the very first line —
// before any other module can import one of those libs.
import {Buffer} from 'buffer';
(globalThis as unknown as {Buffer: typeof Buffer}).Buffer = Buffer;
import App from './App.tsx';
import './index.css';
import {registerPwa} from './pwa';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerPwa();
