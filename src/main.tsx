import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initGlobalRowActions } from './lib/globalRowActions';

// Pre-set AI Studio iframe test cookie to ensure cross-origin/iframe proxy requests pass through
if (typeof document !== 'undefined') {
  try {
    document.cookie = '__SECURE-aistudio_auth_flow_may_set_cookies=true; Path=/; Secure; SameSite=None; Partitioned; Max-Age=86400;';
  } catch {
    // Non-fatal
  }
}

initGlobalRowActions();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
