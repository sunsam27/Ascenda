import type { Metadata } from 'next';
import PlanHistoryPanel from '@/components/admin/PlanHistoryPanel';
export const metadata: Metadata = { title: 'Change history' };
export default function AdminHistoryPage() {
  return <PlanHistoryPanel />;
}
