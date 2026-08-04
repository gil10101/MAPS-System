/**
 * MediSync client entry point.
 *
 * The stylesheet is imported here rather than from a component so Tailwind's
 * base, components and utilities layers are in the bundle before any page
 * mounts — a component class arriving after first paint shows as a flash of
 * unstyled content.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
