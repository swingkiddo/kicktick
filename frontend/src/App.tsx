import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WalletContextProvider } from '@/lib/WalletContext';
import { ClobProvider } from '@/lib/ClobProvider';
import Header from '@/components/Header';
import HomePage from '@/pages/HomePage';
import AdminPage from '@/pages/AdminPage';
import { AdminAuthGuard } from '@/admin/AdminAuthGuard';
import { WebSocketProvider } from '@/admin/WebSocketProvider';
import { TestWalletProvider } from '@/lib/TestWalletContext';

export default function App() {
  return (
    <BrowserRouter>
      <WalletContextProvider>
        <TestWalletProvider><ClobProvider>
          <div className="min-h-screen">
            <Header />
            <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/admin" element={
              <AdminAuthGuard>
                <WebSocketProvider>
                  <AdminPage />
                </WebSocketProvider>
              </AdminAuthGuard>
            } />
            <Route path="/admin/*" element={
              <AdminAuthGuard>
                <WebSocketProvider>
                  <AdminPage />
                </WebSocketProvider>
              </AdminAuthGuard>
            } />
            </Routes>
          </div>
        </ClobProvider></TestWalletProvider>
      </WalletContextProvider>
    </BrowserRouter>
  );
}
