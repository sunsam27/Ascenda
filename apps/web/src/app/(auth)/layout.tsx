import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sign In' };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-bg" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
      {children}
    </div>
  );
}
