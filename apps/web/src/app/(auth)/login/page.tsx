import type { Metadata } from 'next';
import LoginForm from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign In | Ascenda',
  description: 'Sign in to your Ascenda workspace.',
};

export default function LoginPage() {
  return <LoginForm />;
}
