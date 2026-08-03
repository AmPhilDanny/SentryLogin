import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Shield, Upload, Activity, Bell, Database, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';

export function Layout() {
  const { user, hasRole, logout } = useAuth();
  const navigate = useNavigate();

  const canUpload = hasRole(['manager', 'super_admin']);
  const canConfigure = hasRole(['manager', 'super_admin']);

  const navItems = [
    { to: '/', icon: Activity, label: 'Dashboard' },
    { to: '/alerts', icon: Bell, label: 'Alerts' },
    { to: '/datasets', icon: Database, label: 'Datasets' },
  ];
  if (canUpload) {
    navItems.push({ to: '/upload', icon: Upload, label: 'Upload CSV' });
  }
  if (canConfigure) {
    navItems.push({ to: '/settings/ai', icon: Settings, label: 'AI Settings' });
  }

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-gray-700/50 bg-surface-light px-6 py-3">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-accent" />
          <h1 className="text-lg font-semibold text-white">SentryLogin</h1>
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
            Suspicious Login Analysis
          </span>
        </div>
        <div className="flex items-center gap-4">
          <nav className="flex items-center gap-1">
            {navItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-surface-lighter text-white'
                      : 'text-gray-400 hover:text-white'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          {user && (
            <div className="flex items-center gap-3 border-l border-gray-700/50 pl-4">
              <div className="flex flex-col items-end">
                <span className="text-sm font-medium text-white">
                  {user.displayName || user.email}
                </span>
                <span className="text-xs text-accent">{user.role.replace('_', ' ')}</span>
              </div>
              <button
                onClick={handleLogout}
                className="btn-ghost px-2 py-1.5 text-xs"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
