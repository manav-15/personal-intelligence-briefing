import { useState } from 'react';
import {
  effectiveTopicPreferences,
  type Preferences,
  type Topic,
} from '../shared/preferences';
import { usePreferences } from './usePreferences';

type TopicDraft = {
  id: string;
  name: string;
  enabled: boolean;
  interests: string;
  exclusions: string;
  userWording: string;
  summaryFormat: '' | 'bullets' | 'paragraphs';
  summaryDepth: '' | 'concise' | 'standard' | 'detailed';
  summaryAudience: string;
  summaryEmphasis: string;
  summaryInstructions: string;
  preferredEnabled: boolean;
  preferred: string;
  blockedEnabled: boolean;
  blocked: string;
  officialFirst: '' | 'true' | 'false';
};

/** Renders independently persisted topics and their effective inherited settings. */
export function TopicsScreen() {
  const { preferences, configured, loading, error, update } = usePreferences();
  const [draft, setDraft] = useState<TopicDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (loading) return <LoadingScreen title="Topics" />;

  if (preferences === null)
    return <UnavailableScreen title="Topics" error={error} />;

  async function saveTopic(next: Topic, replacingId?: string) {
    setSaving(true);
    setMessage(null);

    try {
      await update((current) => {
        const topics = replacingId
          ? current.topics.map((topic) =>
              topic.id === replacingId ? next : topic,
            )
          : [...current.topics, next];

        return { ...current, topics };
      });
      setDraft(null);
      setMessage(replacingId ? 'Topic saved.' : 'Topic added.');
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function toggleTopic(topic: Topic) {
    setSaving(true);
    setMessage(null);

    try {
      await update((current) => ({
        ...current,
        topics: current.topics.map((item) =>
          item.id === topic.id ? { ...item, enabled: !item.enabled } : item,
        ),
      }));
      setMessage(topic.enabled ? 'Topic paused.' : 'Topic resumed.');
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function deleteTopic(topic: Topic) {
    if (!window.confirm(`Delete “${topic.name}”? This cannot be undone.`))
      return;

    setSaving(true);
    setMessage(null);

    try {
      await update((current) => ({
        ...current,
        topics: current.topics.filter((item) => item.id !== topic.id),
      }));
      setMessage('Topic deleted.');
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="preferences-screen">
      <p className="eyebrow">YOUR INTERESTS</p>
      <h1>Topics</h1>
      <p className="intro">
        Each topic has its own interests, exclusions, and optional summary and
        source overrides. Shared defaults live in Memory &amp; settings.
      </p>
      <PersistenceStatus
        configured={configured}
        revision={preferences.revision}
      />
      <Feedback message={message} />
      <div className="topic-list" aria-label="Saved topics">
        {preferences.topics.map((topic) => (
          <TopicCard
            key={topic.id}
            topic={topic}
            preferences={preferences}
            disabled={saving}
            onEdit={() => {
              setDraft(toTopicDraft(topic));
            }}
            onToggle={() => void toggleTopic(topic)}
            onDelete={() => void deleteTopic(topic)}
          />
        ))}
      </div>
      {preferences.topics.length === 0 ? (
        <p className="empty-state">No topics yet. Add one below.</p>
      ) : null}
      <div className="form-card">
        <h2>{draft === null ? 'Add a topic' : `Edit ${draft.name}`}</h2>
        <TopicForm
          key={`${String(preferences.revision)}:${draft?.id ?? 'new-topic'}`}
          draft={draft ?? emptyTopicDraft()}
          existingIds={preferences.topics.map((topic) => topic.id)}
          global={preferences.global}
          {...(draft === null
            ? {}
            : {
                onCancel: () => {
                  setDraft(null);
                },
              })}
          onSave={(topic, replacingId) => void saveTopic(topic, replacingId)}
          saving={saving}
        />
      </div>
    </section>
  );
}

/** Renders global briefing defaults that individual topic overrides can inherit. */
export function SettingsScreen() {
  const { preferences, configured, loading, error, update } = usePreferences();
  const [message, setMessage] = useState<string | null>(null);

  if (loading) return <LoadingScreen title="Memory & settings" />;

  if (preferences === null)
    return <UnavailableScreen title="Memory & settings" error={error} />;

  return (
    <SettingsForm
      key={preferences.revision}
      configured={configured}
      message={message}
      preferences={preferences}
      setMessage={setMessage}
      update={update}
    />
  );
}

function SettingsForm({
  preferences,
  configured,
  message,
  setMessage,
  update,
}: {
  preferences: Preferences;
  configured: boolean;
  message: string | null;
  setMessage: (message: string | null) => void;
  update: (transform: (current: Preferences) => Preferences) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(preferences));
  const [saving, setSaving] = useState(false);

  async function save(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      await update(() => draft);
      setMessage('Global settings saved.');
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="preferences-screen">
      <p className="eyebrow">BRIEFING DEFAULTS</p>
      <h1>Memory &amp; settings</h1>
      <p className="intro">
        Set your schedule, total reading budget, and defaults inherited by new
        topics. Conversation and briefing deletion controls arrive with memory.
      </p>
      <PersistenceStatus
        configured={configured}
        revision={preferences.revision}
      />
      <Feedback message={message} />
      <form
        className="preferences-form settings-form"
        onSubmit={(event) => void save(event)}
      >
        <fieldset>
          <legend>Schedule and reading budget</legend>
          <div className="field-grid">
            <Field label="Daily local time">
              <input
                aria-label="Daily local time"
                type="time"
                value={draft.global.schedule.localTime}
                onChange={(event) => {
                  setDraft(
                    setGlobal(draft, 'schedule.localTime', event.target.value),
                  );
                }}
              />
            </Field>
            <Field label="Timezone">
              <input
                aria-label="Timezone"
                value={draft.global.schedule.timezone}
                onChange={(event) => {
                  setDraft(
                    setGlobal(draft, 'schedule.timezone', event.target.value),
                  );
                }}
              />
            </Field>
            <Field label="Target minutes">
              <input
                aria-label="Target minutes"
                type="number"
                min="1"
                max="30"
                value={draft.global.reading.targetMinutes}
                onChange={(event) => {
                  setDraft(
                    setGlobal(
                      draft,
                      'reading.targetMinutes',
                      Number(event.target.value),
                    ),
                  );
                }}
              />
            </Field>
            <Field label="Minimum stories">
              <input
                aria-label="Minimum stories"
                type="number"
                min="1"
                max="30"
                value={draft.global.reading.minStories}
                onChange={(event) => {
                  setDraft(
                    setGlobal(
                      draft,
                      'reading.minStories',
                      Number(event.target.value),
                    ),
                  );
                }}
              />
            </Field>
            <Field label="Maximum stories">
              <input
                aria-label="Maximum stories"
                type="number"
                min="1"
                max="30"
                value={draft.global.reading.maxStories}
                onChange={(event) => {
                  setDraft(
                    setGlobal(
                      draft,
                      'reading.maxStories',
                      Number(event.target.value),
                    ),
                  );
                }}
              />
            </Field>
          </div>
        </fieldset>
        <SummaryFields
          value={draft.global.summary}
          onChange={(summary) => {
            setDraft({ ...draft, global: { ...draft.global, summary } });
          }}
        />
        <SourceFields
          value={draft.global.sources}
          exclusions={draft.global.exclusions}
          onChange={(sources, exclusions) => {
            setDraft({
              ...draft,
              global: { ...draft.global, sources, exclusions },
            });
          }}
        />
        <button className="primary" disabled={saving} type="submit">
          {saving ? 'Saving…' : 'Save global settings'}
        </button>
      </form>
    </section>
  );
}

function TopicCard({
  topic,
  preferences,
  disabled,
  onEdit,
  onToggle,
  onDelete,
}: {
  topic: Topic;
  preferences: Preferences;
  disabled: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const effective = effectiveTopicPreferences(preferences, topic);

  return (
    <article className="topic-card">
      <div className="topic-card-heading">
        <div>
          <p className="eyebrow">{topic.enabled ? 'ACTIVE' : 'PAUSED'}</p>
          <h2>{topic.name}</h2>
        </div>
        <code>{topic.id}</code>
      </div>
      <p>{topic.interests.join(' · ')}</p>
      <dl className="topic-details">
        <div>
          <dt>Effective depth</dt>
          <dd>{effective.summary.depth}</dd>
        </div>
        <div>
          <dt>Exclusions</dt>
          <dd>
            {effective.exclusions.length === 0
              ? 'None'
              : effective.exclusions.join(', ')}
          </dd>
        </div>
        <div>
          <dt>Source policy</dt>
          <dd>
            {effective.sources.officialFirst
              ? 'Official sources first'
              : 'Standard ordering'}
          </dd>
        </div>
      </dl>
      <div className="button-row">
        <button type="button" disabled={disabled} onClick={onEdit}>
          Edit
        </button>
        <button type="button" disabled={disabled} onClick={onToggle}>
          {topic.enabled ? 'Pause' : 'Resume'}
        </button>
        <button
          className="danger"
          type="button"
          disabled={disabled}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

function TopicForm({
  draft: original,
  existingIds,
  global,
  onCancel,
  onSave,
  saving,
}: {
  draft: TopicDraft;
  existingIds: string[];
  global: Preferences['global'];
  onCancel?: () => void;
  onSave: (topic: Topic, replacingId?: string) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(original);

  function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const isExisting = existingIds.includes(draft.id);
    const id = isExisting ? draft.id : uniqueTopicId(draft.name, existingIds);

    onSave(toTopic(draft, id), isExisting ? draft.id : undefined);
  }

  return (
    <form className="preferences-form" onSubmit={submit}>
      <div className="field-grid">
        <Field label="Topic name">
          <input
            value={draft.name}
            onChange={(event) => {
              setDraft({ ...draft, name: event.target.value });
            }}
            required
            maxLength={120}
          />
        </Field>
        <Field label="Topic ID">
          <input value={draft.id || 'Created from the topic name'} disabled />
        </Field>
      </div>
      <Field label="Interests (one per line)">
        <textarea
          value={draft.interests}
          onChange={(event) => {
            setDraft({ ...draft, interests: event.target.value });
          }}
          required
        />
      </Field>
      <Field label="Exclude from this topic (one per line)">
        <textarea
          value={draft.exclusions}
          onChange={(event) => {
            setDraft({ ...draft, exclusions: event.target.value });
          }}
        />
      </Field>
      <Field label="Your wording for this topic">
        <textarea
          value={draft.userWording}
          onChange={(event) => {
            setDraft({ ...draft, userWording: event.target.value });
          }}
        />
      </Field>
      <fieldset>
        <legend>Summary overrides</legend>
        <p className="hint">
          Inherited values are shown in each control. Override only the parts
          this topic needs to change.
        </p>
        <div className="field-grid">
          <Field label="Format">
            <select
              value={draft.summaryFormat}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  summaryFormat: event.target
                    .value as TopicDraft['summaryFormat'],
                });
              }}
            >
              <option value="">{`Inherit (${summaryFormatLabel(global.summary.format)})`}</option>
              <option value="bullets">Bullets</option>
              <option value="paragraphs">Paragraphs</option>
            </select>
          </Field>
          <Field label="Depth">
            <select
              value={draft.summaryDepth}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  summaryDepth: event.target
                    .value as TopicDraft['summaryDepth'],
                });
              }}
            >
              <option value="">{`Inherit (${summaryDepthLabel(global.summary.depth)})`}</option>
              <option value="concise">Concise</option>
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
            </select>
          </Field>
          <Field label="Audience">
            <input
              value={draft.summaryAudience}
              onChange={(event) => {
                setDraft({ ...draft, summaryAudience: event.target.value });
              }}
              placeholder={`Inherit (${global.summary.audience})`}
            />
          </Field>
          <Field label="Emphasis (one per line)">
            <input
              value={draft.summaryEmphasis}
              onChange={(event) => {
                setDraft({ ...draft, summaryEmphasis: event.target.value });
              }}
              placeholder={`Inherit (${joinLines(global.summary.emphasis) || 'none'})`}
            />
          </Field>
        </div>
        <Field label="Summary instructions">
          <textarea
            value={draft.summaryInstructions}
            onChange={(event) => {
              setDraft({ ...draft, summaryInstructions: event.target.value });
            }}
            placeholder={`Inherit (${global.summary.instructions || 'no additional instructions'})`}
          />
        </Field>
      </fieldset>
      <fieldset>
        <legend>Source overrides</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.preferredEnabled}
            onChange={(event) => {
              setDraft({ ...draft, preferredEnabled: event.target.checked });
            }}
          />{' '}
          {`Override preferred sources (${sourceListLabel(global.sources.preferred)})`}
        </label>
        {draft.preferredEnabled ? (
          <Field label="Preferred HTTPS sources (one per line)">
            <textarea
              value={draft.preferred}
              onChange={(event) => {
                setDraft({ ...draft, preferred: event.target.value });
              }}
            />
          </Field>
        ) : null}
        <label className="check">
          <input
            type="checkbox"
            checked={draft.blockedEnabled}
            onChange={(event) => {
              setDraft({ ...draft, blockedEnabled: event.target.checked });
            }}
          />{' '}
          {`Add blocked sources (${sourceListLabel(global.sources.blocked)})`}
        </label>
        {draft.blockedEnabled ? (
          <Field label="Blocked HTTPS sources (one per line)">
            <textarea
              value={draft.blocked}
              onChange={(event) => {
                setDraft({ ...draft, blocked: event.target.value });
              }}
            />
          </Field>
        ) : null}
        <Field label="Prefer official sources">
          <select
            value={draft.officialFirst}
            onChange={(event) => {
              setDraft({
                ...draft,
                officialFirst: event.target
                  .value as TopicDraft['officialFirst'],
              });
            }}
          >
            <option value="">
              {`Inherit (${global.sources.officialFirst ? 'Yes' : 'No'})`}
            </option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </Field>
      </fieldset>
      <div className="button-row">
        <button className="primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : original.id ? 'Save topic' : 'Add topic'}
        </button>
        {onCancel ? (
          <button type="button" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

function SummaryFields({
  value,
  onChange,
}: {
  value: Preferences['global']['summary'];
  onChange: (value: Preferences['global']['summary']) => void;
}) {
  return (
    <fieldset>
      <legend>Default summary</legend>
      <div className="field-grid">
        <Field label="Format">
          <select
            value={value.format}
            onChange={(event) => {
              onChange({
                ...value,
                format: event.target.value as typeof value.format,
              });
            }}
          >
            <option value="bullets">Bullets</option>
            <option value="paragraphs">Paragraphs</option>
          </select>
        </Field>
        <Field label="Depth">
          <select
            value={value.depth}
            onChange={(event) => {
              onChange({
                ...value,
                depth: event.target.value as typeof value.depth,
              });
            }}
          >
            <option value="concise">Concise</option>
            <option value="standard">Standard</option>
            <option value="detailed">Detailed</option>
          </select>
        </Field>
        <Field label="Audience">
          <input
            value={value.audience}
            onChange={(event) => {
              onChange({ ...value, audience: event.target.value });
            }}
          />
        </Field>
        <Field label="Emphasis (one per line)">
          <textarea
            value={joinLines(value.emphasis)}
            onChange={(event) => {
              onChange({ ...value, emphasis: splitLines(event.target.value) });
            }}
          />
        </Field>
      </div>
      <Field label="Additional instructions">
        <textarea
          value={value.instructions}
          onChange={(event) => {
            onChange({ ...value, instructions: event.target.value });
          }}
        />
      </Field>
    </fieldset>
  );
}

function SourceFields({
  value,
  exclusions,
  onChange,
}: {
  value: Preferences['global']['sources'];
  exclusions: string[];
  onChange: (
    sources: Preferences['global']['sources'],
    exclusions: string[],
  ) => void;
}) {
  return (
    <fieldset>
      <legend>Default sources and exclusions</legend>
      <div className="field-grid">
        <Field label="Preferred HTTPS sources (one per line)">
          <textarea
            value={joinLines(value.preferred)}
            onChange={(event) => {
              onChange(
                { ...value, preferred: splitLines(event.target.value) },
                exclusions,
              );
            }}
          />
        </Field>
        <Field label="Blocked HTTPS sources (one per line)">
          <textarea
            value={joinLines(value.blocked)}
            onChange={(event) => {
              onChange(
                { ...value, blocked: splitLines(event.target.value) },
                exclusions,
              );
            }}
          />
        </Field>
        <Field label="Global exclusions (one per line)">
          <textarea
            value={joinLines(exclusions)}
            onChange={(event) => {
              onChange(value, splitLines(event.target.value));
            }}
          />
        </Field>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={value.officialFirst}
          onChange={(event) => {
            onChange(
              { ...value, officialFirst: event.target.checked },
              exclusions,
            );
          }}
        />{' '}
        Prefer official sources when available
      </label>
    </fieldset>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
function Feedback({ message }: { message: string | null }) {
  return message ? <p className="feedback">{message}</p> : null;
}
function PersistenceStatus({
  configured,
  revision,
}: {
  configured: boolean;
  revision: number;
}) {
  return (
    <p className="hint">
      {configured
        ? `Saved revision ${String(revision)}.`
        : 'Using initial defaults. Your first save creates the persistent document.'}
    </p>
  );
}
function LoadingScreen({ title }: { title: string }) {
  return (
    <section className="planned-screen">
      <p className="eyebrow">LOADING</p>
      <h1>{title}</h1>
      <p className="intro">Loading saved preferences…</p>
    </section>
  );
}
function UnavailableScreen({
  title,
  error,
}: {
  title: string;
  error: string | null;
}) {
  return (
    <section className="planned-screen">
      <p className="eyebrow">LOCAL PREFERENCES</p>
      <h1>{title}</h1>
      <p className="feedback error">
        {error ?? 'Preferences are unavailable.'}
      </p>
    </section>
  );
}
function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : 'Could not save preferences.';
}
function splitLines(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}
function joinLines(value: string[]) {
  return value.join('\n');
}
function summaryFormatLabel(value: 'bullets' | 'paragraphs') {
  return value === 'bullets' ? 'Bullets' : 'Paragraphs';
}
function summaryDepthLabel(value: 'concise' | 'standard' | 'detailed') {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
function sourceListLabel(value: string[]) {
  return value.length === 0
    ? 'currently none'
    : `currently ${String(value.length)} source${value.length === 1 ? '' : 's'}`;
}
function setGlobal(
  value: Preferences,
  path:
    | 'schedule.localTime'
    | 'schedule.timezone'
    | 'reading.targetMinutes'
    | 'reading.minStories'
    | 'reading.maxStories',
  next: string | number,
): Preferences {
  const [group, key] = path.split('.') as ['schedule' | 'reading', string];

  return {
    ...value,
    global: {
      ...value.global,
      [group]: { ...value.global[group], [key]: next },
    },
  };
}
function emptyTopicDraft(): TopicDraft {
  return {
    id: '',
    name: '',
    enabled: true,
    interests: '',
    exclusions: '',
    userWording: '',
    summaryFormat: '',
    summaryDepth: '',
    summaryAudience: '',
    summaryEmphasis: '',
    summaryInstructions: '',
    preferredEnabled: false,
    preferred: '',
    blockedEnabled: false,
    blocked: '',
    officialFirst: '',
  };
}
function toTopicDraft(topic: Topic): TopicDraft {
  return {
    id: topic.id,
    name: topic.name,
    enabled: topic.enabled,
    interests: joinLines(topic.interests),
    exclusions: joinLines(topic.exclusions),
    userWording: topic.userWording,
    summaryFormat: topic.summaryOverrides.format ?? '',
    summaryDepth: topic.summaryOverrides.depth ?? '',
    summaryAudience: topic.summaryOverrides.audience ?? '',
    summaryEmphasis: joinLines(topic.summaryOverrides.emphasis ?? []),
    summaryInstructions: topic.summaryOverrides.instructions ?? '',
    preferredEnabled: topic.sourceOverrides.preferred !== undefined,
    preferred: joinLines(topic.sourceOverrides.preferred ?? []),
    blockedEnabled: topic.sourceOverrides.blocked !== undefined,
    blocked: joinLines(topic.sourceOverrides.blocked ?? []),
    officialFirst:
      topic.sourceOverrides.officialFirst === undefined
        ? ''
        : (String(topic.sourceOverrides.officialFirst) as 'true' | 'false'),
  };
}
function toTopic(draft: TopicDraft, id: string): Topic {
  return {
    id,
    name: draft.name.trim(),
    enabled: draft.enabled,
    interests: splitLines(draft.interests),
    exclusions: splitLines(draft.exclusions),
    userWording: draft.userWording.trim(),
    summaryOverrides: {
      ...(draft.summaryFormat ? { format: draft.summaryFormat } : {}),
      ...(draft.summaryDepth ? { depth: draft.summaryDepth } : {}),
      ...(draft.summaryAudience.trim()
        ? { audience: draft.summaryAudience.trim() }
        : {}),
      ...(splitLines(draft.summaryEmphasis).length
        ? { emphasis: splitLines(draft.summaryEmphasis) }
        : {}),
      ...(draft.summaryInstructions.trim()
        ? { instructions: draft.summaryInstructions.trim() }
        : {}),
    },
    sourceOverrides: {
      ...(draft.preferredEnabled
        ? { preferred: splitLines(draft.preferred) }
        : {}),
      ...(draft.blockedEnabled ? { blocked: splitLines(draft.blocked) } : {}),
      ...(draft.officialFirst
        ? { officialFirst: draft.officialFirst === 'true' }
        : {}),
    },
    searchConcepts: [],
  };
}
function uniqueTopicId(name: string, existingIds: string[]) {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '')
      .slice(0, 60) || 'topic';
  let candidate = base;
  let suffix = 2;

  while (existingIds.includes(candidate)) {
    candidate = `${base.slice(0, 62)}-${String(suffix)}`;
    suffix += 1;
  }

  return candidate;
}
