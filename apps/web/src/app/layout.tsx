import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: {
    template: '%s | Ascenda',
    default: 'Ascenda — People & Payroll Platform',
  },
  description:
    'Ascenda is a people, payroll and workforce intelligence platform for churches, SMEs, NGOs and schools.',
  robots: { index: false, follow: false }, // Private app — not for search indexing
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1D4ED8',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
