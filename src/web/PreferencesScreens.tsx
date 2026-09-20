import { Fragment, useState } from 'react';
import {
  effectiveTopicPreferences,
  type Preferences,
  type Topic,
} from '../shared/preferences';
import type { StoredTopicProposal } from './preferences-client';
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
  const {
    preferences,
    configured,
    loading,
    error,
    proposals,
    update,
    proposeTopic,
    actOnProposal,
  } = usePreferences();
  const [draft, setDraft] = useState<TopicDraft | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
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
      setEditorOpen(false);
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
      <TopicProposalPanel
        preferences={preferences}
        proposals={proposals}
        saving={saving}
        onPropose={async (request) => {
          setSaving(true);
          setMessage(null);

          try {
            await proposeTopic(request);
            setMessage('Proposal ready for review. Preferences are unchanged.');
          } catch (caught) {
            setMessage(errorMessage(caught));
          } finally {
            setSaving(false);
          }
        }}
        onAction={async (proposalId, action) => {
          setSaving(true);
          setMessage(null);

          try {
            await actOnProposal(proposalId, action);
            setMessage(
              action === 'apply' ? 'Proposal applied.' : 'Proposal discarded.',
            );
          } catch (caught) {
            setMessage(errorMessage(caught));
          } finally {
            setSaving(false);
          }
        }}
      />
      <div
        className="topic-list"
        aria-label={configured ? 'Saved topics' : 'Suggested topics, not saved'}
      >
        {preferences.topics.map((topic) => (
          <Fragment key={topic.id}>
            <TopicCard
              topic={topic}
              preferences={preferences}
              disabled={saving}
              expanded={selectedTopicId === topic.id}
              onSelect={() => {
                setSelectedTopicId(topic.id);
              }}
            />
            {selectedTopicId === topic.id ? (
              <TopicDetailsPanel
                topic={topic}
                preferences={preferences}
                disabled={saving}
                onClose={() => {
                  setSelectedTopicId(null);
                }}
                onEdit={() => {
                  setDraft(toTopicDraft(topic));
                  setEditorOpen(true);
                  setSelectedTopicId(null);
                }}
                onToggle={() => void toggleTopic(topic)}
                onDelete={() => {
                  setSelectedTopicId(null);
                  void deleteTopic(topic);
                }}
              />
            ) : null}
          </Fragment>
        ))}
      </div>
      {preferences.topics.length === 0 ? (
        <p className="empty-state">No topics yet. Add one below.</p>
      ) : null}
      <details
        className="form-card topic-editor"
        open={editorOpen}
        onToggle={(event) => {
          setEditorOpen(event.currentTarget.open);
        }}
      >
        <summary>
          <strong>
            {draft === null ? 'Add a topic' : `Edit ${draft.name}`}
          </strong>
          <span>
            {draft === null
              ? 'Create a topic manually'
              : 'Change the selected topic'}
          </span>
        </summary>
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
                  setEditorOpen(false);
                },
              })}
          onSave={(topic, replacingId) => void saveTopic(topic, replacingId)}
          saving={saving}
        />
      </details>
    </section>
  );
}

/** Lets the user request, review, apply, or discard a scoped model proposal. */
function TopicProposalPanel({
  preferences,
  proposals,
  saving,
  onPropose,
  onAction,
}: {
  preferences: Preferences;
  proposals: StoredTopicProposal[];
  saving: boolean;
  onPropose: (request: {
    request: string;
    scope:
      { operation: 'add-topic' } | { operation: 'edit-topic'; topicId: string };
  }) => Promise<void>;
  onAction: (proposalId: string, action: 'apply' | 'discard') => Promise<void>;
}) {
  const [request, setRequest] = useState('');
  const [target, setTarget] = useState('add-topic');
  const pendingCards = proposals.map((stored) => {
    const { scope } = stored.proposal;
    const existingTopic =
      scope.operation === 'edit-topic'
        ? preferences.topics.find((topic) => topic.id === scope.topicId)
        : undefined;

    return { stored, existingTopic };
  });

  function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const scope =
      target === 'add-topic'
        ? { operation: 'add-topic' as const }
        : { operation: 'edit-topic' as const, topicId: target };

    void onPropose({ request, scope }).then(() => {
      setRequest('');
    });
  }

  return (
    <section className="proposal-panel" aria-label="Topic proposal">
      <p className="eyebrow">ASSISTED EDITING</p>
      <h2>Describe a topic change</h2>
      <p className="hint">
        The proposal changes nothing until you review and apply it. It can only
        add or update the selected topic.
      </p>
      <form className="preferences-form" onSubmit={submit}>
        <Field label="Topic to change">
          <select
            aria-label="Topic to change"
            value={target}
            disabled={saving}
            onChange={(event) => {
              setTarget(event.target.value);
            }}
          >
            <option value="add-topic">Add a new topic</option>
            {preferences.topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                Edit {topic.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What should change?">
          <textarea
            aria-label="What should change?"
            value={request}
            disabled={saving}
            maxLength={1000}
            placeholder="For example: Follow official AI model releases and developer tools, but exclude stock-price coverage. Use concise technical bullets."
            onChange={(event) => {
              setRequest(event.target.value);
            }}
            required
          />
        </Field>
        <button className="primary" disabled={saving} type="submit">
          {saving ? 'Creating proposal…' : 'Create proposal'}
        </button>
      </form>
      {pendingCards.map(({ stored, existingTopic }) => (
        <TopicProposalCard
          key={stored.proposal.id}
          existingTopic={existingTopic}
          stored={stored}
          disabled={saving}
          onAction={onAction}
        />
      ))}
    </section>
  );
}

/** Shows a complete proposed topic beside its selected current topic. */
function TopicProposalCard({
  stored,
  existingTopic,
  disabled,
  onAction,
}: {
  stored: StoredTopicProposal;
  existingTopic: Topic | undefined;
  disabled: boolean;
  onAction: (proposalId: string, action: 'apply' | 'discard') => Promise<void>;
}) {
  const { proposal } = stored;
  const hasQuestions = proposal.unresolvedQuestions.length > 0;

  return (
    <article className="proposal-card">
      <p className="eyebrow">PENDING REVIEW</p>
      <h3>{proposal.proposedTopic.name}</h3>
      <p>{proposal.explanation}</p>
      <p className="hint">Request: {proposal.request}</p>
      <div className="proposal-comparison">
        <TopicSummary label="Current" topic={existingTopic} />
        <TopicSummary label="Proposed" topic={proposal.proposedTopic} />
      </div>
      {hasQuestions ? (
        <div className="proposal-questions">
          <strong>Clarification needed before Apply</strong>
          <ul>
            {proposal.unresolvedQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="hint">Prompt version: {stored.promptVersion}</p>
      <div className="button-row">
        <button
          className="primary"
          type="button"
          disabled={disabled || hasQuestions}
          onClick={() => void onAction(proposal.id, 'apply')}
        >
          Apply proposal
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void onAction(proposal.id, 'discard')}
        >
          Discard
        </button>
      </div>
    </article>
  );
}

/** Summarizes the small set of topic fields that matter most during review. */
function TopicSummary({
  label,
  topic,
}: {
  label: string;
  topic: Topic | undefined;
}) {
  return (
    <div>
      <strong>{label}</strong>
      {topic === undefined ? (
        <p>New topic</p>
      ) : (
        <dl className="topic-details">
          <div>
            <dt>Name</dt>
            <dd>{topic.name}</dd>
          </div>
          <div>
            <dt>Interests</dt>
            <dd>{topic.interests.join(', ')}</dd>
          </div>
          <div>
            <dt>Exclusions</dt>
            <dd>
              {topic.exclusions.length === 0
                ? 'None'
                : topic.exclusions.join(', ')}
            </dd>
          </div>
          <div>
            <dt>Preference narrative</dt>
            <dd>{topic.userWording || 'None'}</dd>
          </div>
          <div>
            <dt>Summary overrides</dt>
            <dd>{summaryOverrideLabel(topic)}</dd>
          </div>
          <div>
            <dt>Source overrides</dt>
            <dd>{sourceOverrideLabel(topic)}</dd>
          </div>
          <div>
            <dt>Search concepts</dt>
            <dd>{searchConceptLabel(topic)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function summaryOverrideLabel(topic: Topic): string {
  const entries = Object.entries(topic.summaryOverrides).map(
    ([key, value]) =>
      `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`,
  );

  return entries.length === 0 ? 'Inherited' : entries.join(' · ');
}

function sourceOverrideLabel(topic: Topic): string {
  const entries = Object.entries(topic.sourceOverrides).map(
    ([key, value]) =>
      `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`,
  );

  return entries.length === 0 ? 'Inherited' : entries.join(' · ');
}

function searchConceptLabel(topic: Topic): string {
  if (topic.searchConcepts.length === 0) return 'None';

  return topic.searchConcepts
    .map((concept) => `${concept.terms.join(' ')} (${concept.intent})`)
    .join(' · ');
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
  expanded,
  onSelect,
}: {
  topic: Topic;
  preferences: Preferences;
  disabled: boolean;
  expanded: boolean;
  onSelect: () => void;
}) {
  const effective = effectiveTopicPreferences(preferences, topic);

  function selectFromKeyboard(event: React.KeyboardEvent<HTMLElement>) {
    if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return;

    event.preventDefault();
    onSelect();
  }

  return (
    <article
      className="topic-card topic-card-trigger"
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-expanded={expanded}
      aria-controls={`topic-details-${topic.id}`}
      aria-label={`View details for ${topic.name}`}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      onKeyDown={selectFromKeyboard}
    >
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
      <p className="topic-card-action">View details</p>
    </article>
  );
}

/** Shows complete topic details directly after the selected topic card. */
function TopicDetailsPanel({
  topic,
  preferences,
  disabled,
  onClose,
  onEdit,
  onToggle,
  onDelete,
}: {
  topic: Topic;
  preferences: Preferences;
  disabled: boolean;
  onClose: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const effective = effectiveTopicPreferences(preferences, topic);

  return (
    <article
      id={`topic-details-${topic.id}`}
      className="topic-details-panel"
      aria-labelledby={`topic-details-heading-${topic.id}`}
    >
      <div className="topic-card-heading">
        <div>
          <p className="eyebrow">{topic.enabled ? 'ACTIVE' : 'PAUSED'}</p>
          <h2 id={`topic-details-heading-${topic.id}`}>{topic.name}</h2>
        </div>
        <button
          type="button"
          aria-label="Collapse topic details"
          onClick={onClose}
        >
          Collapse
        </button>
      </div>
      <dl className="topic-details topic-details-expanded">
        <div>
          <dt>Topic ID</dt>
          <dd>{topic.id}</dd>
        </div>
        <div>
          <dt>Interests</dt>
          <dd>{topic.interests.join(', ')}</dd>
        </div>
        <div>
          <dt>Exclusions</dt>
          <dd>
            {topic.exclusions.length === 0
              ? 'None'
              : topic.exclusions.join(', ')}
          </dd>
        </div>
        <div>
          <dt>Preference narrative</dt>
          <dd>{topic.userWording || 'None'}</dd>
        </div>
        <div>
          <dt>Summary overrides</dt>
          <dd>{summaryOverrideLabel(topic)}</dd>
        </div>
        <div>
          <dt>Effective summary</dt>
          <dd>
            {`${effective.summary.format ?? 'Unspecified'} · ${effective.summary.depth ?? 'Unspecified'} · ${effective.summary.audience ?? 'Unspecified'}`}
          </dd>
        </div>
        <div>
          <dt>Source overrides</dt>
          <dd>{sourceOverrideLabel(topic)}</dd>
        </div>
        <div>
          <dt>Effective source policy</dt>
          <dd>
            {effective.sources.officialFirst
              ? 'Official sources first'
              : 'Standard ordering'}
          </dd>
        </div>
        <div>
          <dt>Search concepts</dt>
          <dd>{searchConceptLabel(topic)}</dd>
        </div>
      </dl>
      <div className="button-row">
        <button
          className="primary"
          type="button"
          disabled={disabled}
          onClick={onEdit}
        >
          Edit topic
        </button>
        <button type="button" disabled={disabled} onClick={onToggle}>
          {topic.enabled ? 'Pause topic' : 'Resume topic'}
        </button>
        <button
          className="danger"
          type="button"
          disabled={disabled}
          onClick={onDelete}
        >
          Delete topic
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
      <Field label="Preference narrative">
        <textarea
          value={draft.userWording}
          onChange={(event) => {
            setDraft({ ...draft, userWording: event.target.value });
          }}
        />
        <p className="hint">
          Keep context that structured interests and exclusions cannot express.
          Assisted edits combine this with your new request.
        </p>
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
        : 'Nothing is saved yet — this is the suggested starting point. Your first save creates the persistent document.'}
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
