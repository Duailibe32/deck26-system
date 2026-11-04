import React from 'react';
import ReactDOM from 'react-dom/client';
import '@deck26/ui/tokens.css';
import { WebPortalApp } from './App.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WebPortalApp />
  </React.StrictMode>
);
