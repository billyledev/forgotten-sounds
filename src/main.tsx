import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { audio } from './audio/AudioEngine';
import './styles.css';

// Debug handle for console/tunnel-based diagnostics (harmless in prod).
(window as unknown as { __AUDIO: typeof audio }).__AUDIO = audio;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
