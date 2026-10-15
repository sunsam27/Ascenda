import type { Metadata } from 'next';
import PeopleView from '@/components/people/PeopleView';

export const metadata: Metadata = { title: 'People | Ascenda' };

export default function PeoplePage() {
  return <PeopleView />;
}
