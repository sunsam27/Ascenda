import type { Metadata } from 'next';
import Hero from '@/components/marketing/Hero';
import FeatureGrid from '@/components/marketing/FeatureGrid';
import Workflow from '@/components/marketing/Workflow';
import SecurityBand from '@/components/marketing/SecurityBand';
import Audiences from '@/components/marketing/Audiences';
import FinalCTA from '@/components/marketing/FinalCTA';

export const metadata: Metadata = {
  // absolute: brand already in the title, so skip the layout's "| Ascenda" template
  title: {
    absolute: 'Ascenda — People, payroll and workforce intelligence',
  },
  description:
    'Ascenda brings workers, leave, payroll runs, payments and reporting into one secure workspace — built for churches, SMEs, NGOs and schools.',
};

/** Marketing home page — replaces the old root redirect to /login */
export default function HomePage() {
  return (
    <>
      <Hero />
      <FeatureGrid />
      <Workflow />
      <SecurityBand />
      <Audiences />
      <FinalCTA />
    </>
  );
}
