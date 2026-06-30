import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PasswordGate } from './components/PasswordGate';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { PlayerPage } from './features/player/PlayerPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { VocabularyPage } from './features/vocabulary/VocabularyPage';
import { isRemoteAccess } from './lib/env';
import { loadRuntimeEnvConfig } from './lib/runtimeConfig';

function App() {
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadRuntimeEnvConfig().finally(() => {
      if (!cancelled) setConfigReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!configReady) return null;

  const content = (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="player/:id" element={<PlayerPage />} />
        <Route path="vocabulary" element={<VocabularyPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );

  // Only require password for remote access
  if (isRemoteAccess) {
    return <PasswordGate>{content}</PasswordGate>;
  }

  return content;
}

export default App;
