import { useEffect, useState } from 'react';
import { healthSchema } from '../shared/health';

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
      <section aria-labelledby="welcome">
        <p className="eyebrow">A little perspective, every day</p>
        <h1 id="welcome">
          Your interests.
          <br />A clearer picture.
        </h1>
        <p className="intro">
          A daily briefing for the stories you care about, with context and
          sources you can explore.
        </p>
        <div className="notice">
          <h2>The foundation is ready.</h2>
          <p>
            Briefings, topics, and conversations are coming in the next
            increments.
          </p>
        </div>
      </section>
      <footer>Built for a more thoughtful morning.</footer>
    </main>
  );
}
