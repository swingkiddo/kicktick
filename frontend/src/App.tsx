import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WalletContextProvider } from '@/lib/WalletContext';
import Header from '@/components/Header';
import HomePage from '@/pages/HomePage';
import AdminPage from '@/pages/AdminPage';

export default function App() {
  return (
    <BrowserRouter>
      <WalletContextProvider>
        <div className="min-h-screen">
          <Header />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/*" element={<AdminPage />} />
          </Routes>
        </div>
      </WalletContextProvider>
    </BrowserRouter>
  );
}
