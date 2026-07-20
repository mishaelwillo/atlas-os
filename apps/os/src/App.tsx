import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import styles from './App.module.css';

const SECTIONS = [
  { name: 'Mission Control', path: '/' },
  { name: 'Agents', path: '/agents' },
  { name: 'Pipelines', path: '/pipelines' },
  { name: 'Sites', path: '/sites' },
  { name: 'Leads & Outreach', path: '/leads' },
  { name: 'Conversations', path: '/conversations' },
  { name: 'Kanban', path: '/kanban' },
  { name: 'Memory', path: '/memory' },
  { name: 'Model Bench', path: '/model-bench' },
  { name: 'Approvals & Audit', path: '/audit' },
  { name: 'Settings', path: '/settings' },
];

export function ApiStatusCard() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'fail'>('loading');
  const [version, setVersion] = useState<string>('');
  
  const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');

  useEffect(() => {
    let active = true;
    async function checkStatus() {
      try {
        const res = await fetch(`${apiUrl}/healthz`);
        if (!res.ok) throw new Error('Not ok');
        const data = await res.json();
        if (active) {
          setStatus('ok');
          setVersion(data.version || '0.1.0');
        }
      } catch (err) {
        if (active) {
          setStatus('fail');
        }
      }
    }
    checkStatus();
    const interval = setInterval(checkStatus, 10000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [apiUrl]);

  return (
    <div className={`${styles.statusCard} ${styles[status]}`} data-testid="status-card">
      <div className={styles.cardHeader}>
        <div className={styles.pulseContainer}>
          <span className={styles.pulse} />
        </div>
        <h3>System API Integration</h3>
      </div>
      <div className={styles.cardBody}>
        <p className={styles.urlLabel}>Endpoint: <code>{apiUrl}/healthz</code></p>
        <p className={styles.statusLabel}>
          Status: <strong>{status.toUpperCase()}</strong>
        </p>
        {status === 'ok' && <p className={styles.versionLabel}>Version: <code>v{version}</code></p>}
      </div>
    </div>
  );
}

export function Sidebar() {
  const location = useLocation();
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <h2>ATLAS OS</h2>
        <span className={styles.badge}>v0.1.0</span>
      </div>
      <nav className={styles.nav}>
        {SECTIONS.map((sec) => {
          const isActive = location.pathname === sec.path;
          return (
            <Link
              key={sec.name}
              to={sec.path}
              className={`${styles.navItem} ${isActive ? styles.activeNavItem : ''}`}
            >
              {sec.name}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function MissionControlPage() {
  return (
    <div className={styles.pageContent}>
      <header className={styles.pageHeader}>
        <h1>Mission Control</h1>
        <p className={styles.subtitle}>Unified Operations & Agent Dashboard</p>
      </header>
      <div className={styles.grid}>
        <ApiStatusCard />
        <div className={styles.infoCard}>
          <h3>Core Control Hub</h3>
          <p>Welcome to Atlas OS command center. This interface coordinates intelligence workspace operations, pipelines, and autonomous agent executions.</p>
        </div>
      </div>
    </div>
  );
}

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className={styles.pageContent}>
      <header className={styles.pageHeader}>
        <h1>{title}</h1>
        <p className={styles.subtitle}>Component stub and route validation</p>
      </header>
      <div className={styles.grid}>
        <div className={styles.infoCard}>
          <h3>Module Under Construction</h3>
          <p>This is a placeholder page for the <strong>{title}</strong> route. Real service components will be scaffolded in the upcoming development lane.</p>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div className={styles.appLayout}>
        <Sidebar />
        <main className={styles.mainContent}>
          <Routes>
            <Route path="/" element={<MissionControlPage />} />
            {SECTIONS.slice(1).map((sec) => (
              <Route
                key={sec.name}
                path={sec.path}
                element={<PlaceholderPage title={sec.name} />}
              />
            ))}
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
