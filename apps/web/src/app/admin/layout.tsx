import type { Metadata } from 'next';
import AdminShell from '@/components/admin/AdminShell';
export const metadata: Metadata = {
  title: { template: '%s | Ascenda Admin', default: 'Ascenda Admin' },
  robots: { index: false, follow: false },
};
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
