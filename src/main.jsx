import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import './styles/wizard.css';
import App from './App.jsx';
import { initTheme } from './lib/theme.js';
import { registerServiceWorker } from './lib/push.js';

initTheme();
// Web Push lands in public/sw.js; registration is idempotent and harmless without VAPID keys
window.addEventListener('load', () => { registerServiceWorker(); });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
