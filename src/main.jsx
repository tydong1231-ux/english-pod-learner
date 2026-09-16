import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './lib/pwaInstall';
import { isWebBuild } from './lib/env';
import { requestOfflineStorage } from './lib/storagePersistence';

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
