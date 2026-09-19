import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './lib/pwaInstall';
import { isWebBuild } from './lib/env';
import { requestOfflineStorage } from './lib/storagePersistence';

// Existing iPhone installations may retain the old manifest launch URL.
// Only migrate a cold, online standalone launch; normal Offline navigation and
// offline cold starts remain available without a network/password dependency.
if ((navigator.standalone || window.matchMedia('(display-mode: standalone)').matches)
    && navigator.onLine && /^#\/offline\/?$/.test(window.location.hash)) {
  window.history.replaceState(null, '', '/#/');
}
if ((navigator.standalone || window.matchMedia('(display-mode: standalone)').matches)
    && !navigator.onLine && (!window.location.hash || /^#\/?$/.test(window.location.hash))) {
  window.history.replaceState(null, '', '/#/offline');
}

if (isWebBuild && import.meta.env.PROD && 'serviceWorker' in navigator) {
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
    requestOfflineStorage();
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('Offline startup registration failed:', error);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
