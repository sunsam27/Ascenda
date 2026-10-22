import type { Metadata } from 'next';
import EmployeeDashboard from '@/components/me/EmployeeDashboard';

export const metadata: Metadata = { title: 'My workspace | Ascenda' };

export default function MePage() {
  return <EmployeeDashboard />;
}
