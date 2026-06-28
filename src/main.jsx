import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from './contexts/AuthContext';
import { CurrencyProvider } from './contexts/CurrencyContext';
import App from './App.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Profile from './pages/Profile.jsx';
import Orders from './pages/Orders.jsx';
import Addresses from './pages/Addresses.jsx';
import Lots from './pages/Lots.jsx';
import PaymentPage from './pages/PaymentPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import HowItWorks from './pages/HowItWorks.jsx';
import './index.css';

const GOOGLE_CLIENT_ID = "933530419477-j18kgi9u914anhe3j8jf1chgfrva2rkr.apps.googleusercontent.com";

createRoot(document.getElementById('root')).render(
  <HelmetProvider>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <StrictMode>
        <BrowserRouter>
          <CurrencyProvider>
            <AuthProvider>
              <Routes>
                <Route path="/" element={<App />} />
                <Route path="/lots" element={<Lots />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/addresses" element={<Addresses />} />
                <Route path="/pay" element={<PaymentPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/how-it-works" element={<HowItWorks />} />
              </Routes>
            </AuthProvider>
            <Analytics />
          </CurrencyProvider>
        </BrowserRouter>
      </StrictMode>
    </GoogleOAuthProvider>
  </HelmetProvider>,
);
