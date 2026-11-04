import React from 'react';
import ReactDOM from 'react-dom/client';
import '@deck26/ui/tokens.css';
import './desktop.css';
import { DesktopApp } from './App.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesktopApp />
  </React.StrictMode>
);
