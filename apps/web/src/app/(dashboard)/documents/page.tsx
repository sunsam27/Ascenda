import type { Metadata } from 'next';
import DocumentsView from '@/components/documents/DocumentsView';

export const metadata: Metadata = { title: 'Documents | Ascenda' };

export default function DocumentsPage() {
  return <DocumentsView />;
}
