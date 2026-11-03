import '@fontsource-variable/source-serif-4';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { RefreshProvider, ToastProvider } from './hooks';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <RefreshProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </RefreshProvider>
    </BrowserRouter>
  </StrictMode>,
);
