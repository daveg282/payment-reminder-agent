import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { api, setUnauthorizedHandler } from './api';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { CustomerDetailPage } from './pages/CustomerDetail';
import { CustomersPage } from './pages/Customers';
import { DashboardPage } from './pages/Dashboard';
import { DraftsPage } from './pages/Drafts';
import { ImportPage } from './pages/Import';
import { LoginPage } from './pages/Login';
import { RepliesPage } from './pages/Replies';

export default function App() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out' | 'offline'>('checking');

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth('out'));
    api.me().then(
      (r) => setAuth(r.authed ? 'in' : 'out'),
      () => setAuth('offline'),
    );
  }, []);

  if (auth === 'checking') return <Loading label="Starting…" />;
  if (auth === 'offline')
    return (
      <div className="page">
        <div className="panel state" role="alert">
          <h3>Can't reach the server</h3>
          <p>The API isn't responding. Start it with npm run dev, then reload this page.</p>
          <button className="btn" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  if (auth === 'out') return <LoginPage onLoggedIn={() => setAuth('in')} />;

  const logout = () => api.logout().finally(() => setAuth('out'));
  return (
    <Layout onLogout={logout}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/drafts" element={<DraftsPage />} />
        <Route path="/replies" element={<RepliesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
