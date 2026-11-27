import "@fortawesome/fontawesome-free/css/all.min.css";
import './utils/axiosSetup';
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom';
import AuthProvider from './context/AuthProvider';
import ThemeProvider from './context/ThemeProvider';
import ToastProvider from './context/ToastProvider';
import ConfirmProvider from './context/ConfirmProvider';
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AuthProvider>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </AuthProvider>
  </BrowserRouter>
)
