import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { App } from './App';
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
          <Route
            index
            element={
              <PlannedScreen title="Today">
                Your first generated briefing will appear here. Manual briefing
                generation arrives after saved topics and preference proposals.
              </PlannedScreen>
            }
          />
          <Route
            path="chat"
            element={
              <PlannedScreen title="Chat">
                Grounded questions about cited stories arrive after published
                briefings and evidence memory exist.
              </PlannedScreen>
            }
          />
          <Route
            path="topics"
            element={
              <PlannedScreen title="Topics">
                Add, edit, pause, and delete independent topics in the next
                persistence slice.
              </PlannedScreen>
            }
          />
          <Route
            path="archive"
            element={
              <PlannedScreen title="Archive">
                Saved briefings will appear here after manual generation is
                implemented.
              </PlannedScreen>
            }
          />
          <Route
            path="settings"
            element={
              <PlannedScreen title="Memory & settings">
                Global schedule, reading preferences, and deletion controls
                arrive with persisted preferences.
              </PlannedScreen>
            }
          />
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
