import { Agent } from 'agents';
import { preferencesSchema, type Preferences } from '../shared/preferences';

/** Bindings used by the singleton preferences Agent. */
export type PreferencesAgentEnv = {
  PERSONAL_BRIEFING: DurableObjectNamespace<PersonalBriefingAgent>;
  PREFERENCES_DIAGNOSTICS_ENABLED?: string;
};

/** Absence is distinct from an unsaved set of suggested first-run defaults. */
export type StoredPreferences =
  { configured: false } | { configured: true; preferences: Preferences };

/** Explicit replacement result that remains structured across Durable Object RPC. */
export type PreferenceReplaceResult =
  | { ok: true; preferences: Preferences }
  | { ok: false; currentRevision: number };

/** Stable owner key supplied at the Worker edge; Access `sub` will replace the local placeholder. */
export type UserId = string;

/** Singleton durable owner of preference state. Future conversations and briefings share this Agent. */
export class PersonalBriefingAgent extends Agent<PreferencesAgentEnv> {
  /** Reads the validated preferences document without creating a first-run record. */
  readPreferences(userId: UserId): StoredPreferences {
    this.ensureSchema();

    return this.readStoredPreferences(userId);
  }

  /** Validates and atomically replaces the document when the supplied revision is current. */
  replacePreferences(
    document: unknown,
    expectedRevision: number,
    userId: UserId,
  ): PreferenceReplaceResult {
    this.ensureSchema();
    const preferences = preferencesSchema.parse(document);

    return this.ctx.storage.transactionSync(() => {
      const existing = this.readStoredPreferences(userId);
      const currentRevision = existing.configured
        ? existing.preferences.revision
        : 0;

      if (expectedRevision !== currentRevision)
        return { ok: false, currentRevision };
      const saved = { ...preferences, revision: currentRevision + 1 };

      this.ctx.storage.sql.exec(
        `INSERT INTO preferences (user_id, revision, document) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET revision = excluded.revision, document = excluded.document`,
        userId,
        saved.revision,
        JSON.stringify(saved),
      );

      return { ok: true, preferences: saved };
    });
  }

  /** Reads the stored row after schema initialization without triggering another migration check. */
  private readStoredPreferences(userId: UserId): StoredPreferences {
    const row = [
      ...this.sql<{
        document: string;
      }>`SELECT document FROM preferences WHERE user_id = ${userId}`,
    ][0];

    if (row === undefined) return { configured: false };

    return {
      configured: true,
      preferences: preferencesSchema.parse(JSON.parse(row.document) as unknown),
    };
  }

  /** Applies idempotent, versioned schema migrations before every public operation. */
  private ensureSchema(): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
      );
      const hasMigration = (version: number) =>
        [
          ...this.ctx.storage.sql.exec<{ version: number }>(
            `SELECT version FROM schema_migrations WHERE version = ?`,
            version,
          ),
        ].length !== 0;

      if (!hasMigration(1)) {
        this.ctx.storage.sql.exec(
          `CREATE TABLE preferences (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER NOT NULL, document TEXT NOT NULL)`,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO schema_migrations (version, applied_at) VALUES (1, datetime('now'))`,
        );
      }

      if (hasMigration(2)) return;
      this.ctx.storage.sql.exec(
        `ALTER TABLE preferences RENAME TO preferences_v1`,
      );
      this.ctx.storage.sql.exec(
        `CREATE TABLE preferences (user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL)`,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO preferences (user_id, revision, document) SELECT 'single-user', revision, document FROM preferences_v1 WHERE singleton = 1`,
      );
      this.ctx.storage.sql.exec(`DROP TABLE preferences_v1`);
      this.ctx.storage.sql.exec(
        `INSERT INTO schema_migrations (version, applied_at) VALUES (2, datetime('now'))`,
      );
    });
  }
}
