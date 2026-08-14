import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

// Register the service worker ourselves so the push handlers are live as soon
// as the app loads.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/sw.js', {
        type: import.meta.env.DEV ? 'module' : 'classic',
        scope: '/',
      })
      .catch((err) => console.warn('Service worker registration failed:', err));
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
