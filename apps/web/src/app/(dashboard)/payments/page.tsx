import type { Metadata } from 'next';
import PaymentsView from '@/components/payroll/PaymentsView';

export const metadata: Metadata = { title: 'Payments | Ascenda' };

export default function PaymentsPage() {
  return <PaymentsView />;
}
