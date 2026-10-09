import type { Metadata } from 'next';
import { Suspense } from 'react';
import SetPasswordForm from '@/components/auth/SetPasswordForm';

export const metadata: Metadata = {
  title: 'Set your password | Ascenda',
  description: 'Activate your Ascenda workspace and set your password.',
};

export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordForm />
    </Suspense>
  );
}
