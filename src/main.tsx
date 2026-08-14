// Light unless they have chosen otherwise: the design is the concept art, and
// the concept art is light.
// The saved theme goes on before anything renders; applied inside React it
// would land a frame late and every launch would flash the other palette.
void window.haru?.settings.get('theme').then(saved => {
  document.documentElement.dataset.theme = saved === 'dark' ? 'dark' : 'light';
});
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { CompanionWindow } from './CompanionWindow';
import './styles.css';
import './live2d.css';

const isCompanion = new URLSearchParams(window.location.search).get('view') === 'companion';
if (isCompanion) document.documentElement.dataset.view = 'companion';

createRoot(document.getElementById('root')!).render(<StrictMode>{isCompanion ? <CompanionWindow /> : <App />}</StrictMode>);
