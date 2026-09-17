import { useEffect, useState } from 'react';
import { healthSchema } from '../shared/health';
import { AppShell } from './Screens';

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

  return <AppShell connection={connection} />;
}
