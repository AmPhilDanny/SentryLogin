import { Outlet, NavLink } from 'react-router-dom';
import { Shield, Upload, Activity, Bell } from 'lucide-react';

const navItems = [
  { to: '/', icon: Activity, label: 'Dashboard' },
  { to: '/alerts', icon: Bell, label: 'Alerts' },
  { to: '/upload', icon: Upload, label: 'Upload CSV' },
];

export function Layout() {
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
      </header>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
