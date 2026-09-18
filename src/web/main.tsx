import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { App } from './App';
import { ArchiveScreen, TodayScreen } from './BriefingScreens';
import { SettingsScreen, TopicsScreen } from './PreferencesScreens';
import { InspectScreen, PlannedScreen } from './Screens';
import './styles.css';

const root = document.getElementById('root');

if (!root) throw new Error('Missing application root');

/** Browser entrypoint that mounts the routed React application. */
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<TodayScreen />} />
          <Route
            path="chat"
            element={
              <PlannedScreen title="Chat">
                Grounded questions about cited stories arrive after published
                briefings and evidence memory exist.
              </PlannedScreen>
            }
          />
          <Route path="topics" element={<TopicsScreen />} />
          <Route path="archive" element={<ArchiveScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="inspect" element={<InspectScreen />} />
        </Route>
        <Route
          path="*"
          element={
            <main>
              <h1>Page not found</h1>
              <Link to="/">Back to your briefing</Link>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
