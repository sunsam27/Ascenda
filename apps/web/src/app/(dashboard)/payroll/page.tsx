import type { Metadata } from 'next';
import PayrollView from '@/components/payroll/PayrollView';

export const metadata: Metadata = { title: 'Payroll | Ascenda' };

export default function PayrollPage() {
  return <PayrollView />;
}
