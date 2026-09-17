import type { Metadata } from 'next';
import Link from 'next/link';
import { gateEnabled } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'Summit Lead Pipeline',
  description: 'Internal ops dashboard for the Summit lead data pipeline',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="header-inner">
            <div className="header-title">
              <h1>Summit Lead Pipeline</h1>
              <div className="sub">Internal ops dashboard · lead ingestion &amp; reconciliation</div>
            </div>
            <img className="header-logo" src="/summit-logo.svg" alt="Summit Home Improvement" width={52} height={52} />
            <nav className="site-nav">
              <Link href="/">Dashboard</Link>
              <Link href="/analytics">Analytics</Link>
              <Link href="/leads">Leads &amp; Export</Link>
              {gateEnabled() && <a href="/logout" className="logout">Log out</a>}
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
