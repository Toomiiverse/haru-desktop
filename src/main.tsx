import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { CompanionWindow } from './CompanionWindow';
import './styles.css';
import './live2d.css';

const isCompanion = new URLSearchParams(window.location.search).get('view') === 'companion';
if (isCompanion) document.documentElement.dataset.view = 'companion';

createRoot(document.getElementById('root')!).render(<StrictMode>{isCompanion ? <CompanionWindow /> : <App />}</StrictMode>);
