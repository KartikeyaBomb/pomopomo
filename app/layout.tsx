import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Pomopomo — a little focus goes a long way',
  description: 'Add your tasks, spin a weighted wheel, and focus for 25 minutes. Simple pomodoro sessions for steady progress.',
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
