import type { Metadata } from 'next';
import TimeLeaveView from '@/components/time-leave/TimeLeaveView';

export const metadata: Metadata = { title: 'Time & Leave | Ascenda' };

export default function TimeLeavePage() {
  return <TimeLeaveView />;
}
