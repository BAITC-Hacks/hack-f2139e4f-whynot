import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App, ErrorBoundary } from './App';
import { RoleProvider } from './context/RoleContext';
import { ToastProvider } from './context/ToastContext';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><BrowserRouter><RoleProvider><ToastProvider><App/></ToastProvider></RoleProvider></BrowserRouter></ErrorBoundary></React.StrictMode>);
