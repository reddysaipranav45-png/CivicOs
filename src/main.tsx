import React from 'react'; import { createRoot } from 'react-dom/client'; import 'leaflet/dist/leaflet.css'; import './styles.css'; import './request-form.css'; import App from './App'; import {CivicDataProvider} from './services/CivicDataContext';
createRoot(document.getElementById('root')!).render(<React.StrictMode><CivicDataProvider><App /></CivicDataProvider></React.StrictMode>);
