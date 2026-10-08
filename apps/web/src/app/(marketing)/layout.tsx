import type { Metadata } from 'next';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';

export const metadata: Metadata = {
  title: {
    template: '%s | Ascenda',
    absolute: 'Ascenda — People, payroll and workforce intelligence',
  },
  description:
    'Ascenda brings workers, leave, payroll runs, payments and reporting into one secure workspace — built for churches, SMEs, NGOs and schools.',
  // Marketing pages are public; the app routes keep the root noindex (root layout).
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Ascenda — People, payroll and workforce intelligence',
    description:
      'One secure workspace for workers, leave, payroll runs, payments and reporting. Built for churches, SMEs, NGOs and schools.',
    siteName: 'Ascenda',
    type: 'website',
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary',
    title: 'Ascenda — People, payroll and workforce intelligence',
    description:
      'One secure workspace for workers, leave, payroll runs, payments and reporting.',
  },
};

/** Marketing layout — public pages: sticky header, main content, footer */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="app-bg">
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}
