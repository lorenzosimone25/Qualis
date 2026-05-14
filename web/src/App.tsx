import { DashboardUiProvider } from '@/context/DashboardUiContext';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { ResearchAssistantPage } from '@/pages/ResearchAssistantPage';
import { Route, Routes } from 'react-router-dom';

export default function App() {
  return (
    <DashboardUiProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/research" element={<ResearchAssistantPage />} />
        </Routes>
      </AppShell>
    </DashboardUiProvider>
  );
}
