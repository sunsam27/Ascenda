import type { Metadata } from 'next';
import AppShell from '@/components/layout/AppShell';

export const metadata: Metadata = { title: 'Ascenda' };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
