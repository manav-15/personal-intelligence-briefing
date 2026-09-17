import { useEffect, useState } from 'react';
import { healthSchema } from '../shared/health';
import { Inspection } from './Inspection';

/** Application shell and initial browser-to-Worker connectivity check. */
export function App() {
  const [connection, setConnection] = useState('Connecting…');

  useEffect(() => {
    const controller = new AbortController();

    async function checkConnection() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Connection failed');
        healthSchema.parse(await response.json());
        if (!controller.signal.aborted) setConnection('Connected');
      } catch {
        if (!controller.signal.aborted) setConnection('Connection unavailable');
      }
    }

    void checkConnection();
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <main>
      <header>
        <span className="wordmark">Personal Briefing</span>
        <span className="status" role="status">
          {connection}
        </span>
      </header>
      <Inspection />
      <footer>
        Local inspection only. Searches and extracted text are not saved.
      </footer>
    </main>
  );
}
