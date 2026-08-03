import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './lib/auth';
import { Layout } from './components/Layout';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
import LoginDetail from './pages/LoginDetail';
import Alerts from './pages/Alerts';
import Login from './pages/Login';
import Datasets from './pages/Datasets';
import AiSettings from './pages/AiSettings';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/datasets" element={<Datasets />} />
          <Route path="/settings/ai" element={<AiSettings />} />
          <Route path="/logins/:id" element={<LoginDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
