'use client';

import { useId, useState } from 'react';
import { Check, ChevronDown, ChevronUp, ListChecks, LoaderCircle, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { MAX_DISMISSED_RULES, MAX_RULE_LENGTH, MAX_SESSION_RULES, ruleTextKey, type RuleSuggestion, type SessionRules } from '@/lib/session-rules';
import './session-rules-panel.css';

export type SessionRulesPanelProps = {
  value: SessionRules;
  onChange: (next: SessionRules) => void;
  disabled?: boolean;
  learning?: boolean;
  error?: string;
  aiEnabled: boolean;
  onConnect: () => void;
  onRetry: () => void;
  label?: string;
  placement?: 'workspace' | 'sidebar';
  description?: string;
};

const normalized = ruleTextKey;

function RuleProposal({ suggestion, disabled, atLimit, existingTexts, onApprove, onDismiss }: {
  suggestion: RuleSuggestion;
  disabled: boolean;
  atLimit: boolean;
  existingTexts: string[];
  onApprove: (text: string) => void;
  onDismiss: () => void;
}) {
  const inputId = useId();
  const [text, setText] = useState(suggestion.text);
  const duplicate = existingTexts.includes(normalized(text));
  const invalid = !normalized(text) || text.trim().length > MAX_RULE_LENGTH || duplicate || atLimit;

  return <div className="session-rule-proposal">
    <div className="session-rule-proposal-copy">
      <label htmlFor={inputId}>Suggested rule</label>
      <textarea id={inputId} value={text} onChange={event => setText(event.target.value)} maxLength={MAX_RULE_LENGTH} disabled={disabled} rows={2} aria-describedby={`${inputId}-reason`} />
      <p id={`${inputId}-reason`}>{suggestion.reason}</p>
      {duplicate && <p className="session-rules-hint">This rule is already in your session.</p>}
    </div>
    <div className="session-rule-proposal-actions">
      <button type="button" className="session-rules-button session-rules-primary" disabled={disabled || invalid} onClick={() => onApprove(text.trim())}><Check size={14} />Accept rule</button>
      <button type="button" className="session-rules-button session-rules-secondary" disabled={disabled} onClick={onDismiss}><X size={14} />Reject rule</button>
    </div>
  </div>;
}

export default function SessionRulesPanel({ value, onChange, disabled = false, learning = false, error, aiEnabled, onConnect, onRetry, label = 'Session rules', placement = 'workspace', description = 'Applies to this session. Suggestions need your approval.' }: SessionRulesPanelProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(value.rules.length > 0);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const atLimit = value.rules.length >= MAX_SESSION_RULES;
  const existingTexts = value.rules.map(rule => normalized(rule.text));
  const draftDuplicate = !!draft.trim() && existingTexts.includes(normalized(draft));
  const editDuplicate = value.rules.some(rule => rule.id !== editingId && normalized(rule.text) === normalized(editingText));
  const acceptedCount = value.feedback.filter(feedback => feedback.decision === 'accepted').length;
  const rejectedCount = value.feedback.filter(feedback => feedback.decision === 'rejected').length;

  function addRule() {
    const text = draft.trim();
    if (disabled || atLimit || !normalized(text) || text.length > MAX_RULE_LENGTH || draftDuplicate) return;
    onChange({ ...value, rules: [...value.rules, { id: crypto.randomUUID(), text, source: 'manual' }] });
    setDraft('');
  }

  function saveRule() {
    const text = editingText.trim();
    if (disabled || !value.rules.some(rule => rule.id === editingId) || !normalized(text) || text.length > MAX_RULE_LENGTH || editDuplicate) return;
    onChange({ ...value, rules: value.rules.map(rule => rule.id === editingId ? { ...rule, text } : rule) });
    setEditingId(null);
  }

  function approveSuggestion(suggestion: RuleSuggestion, text: string) {
    if (disabled || atLimit || !normalized(text) || text.length > MAX_RULE_LENGTH || existingTexts.includes(normalized(text))) return;
    onChange({ ...value, rules: [...value.rules, { id: crypto.randomUUID(), text, source: 'learned' }], suggestions: value.suggestions.filter(item => item.id !== suggestion.id) });
  }

  function dismissSuggestion(suggestion: RuleSuggestion) {
    if (disabled) return;
    const dismissedRules = value.dismissedRules.some(text => normalized(text) === normalized(suggestion.text))
      ? value.dismissedRules
      : [...value.dismissedRules, suggestion.text].slice(-MAX_DISMISSED_RULES);
    onChange({ ...value, suggestions: value.suggestions.filter(item => item.id !== suggestion.id), dismissedRules });
  }

  return <section className={`session-rules-panel session-rules-panel--${placement}`} aria-label={label}>
    <button type="button" className="session-rules-toggle" aria-expanded={expanded} aria-controls={`${panelId}-rules`} onClick={() => setExpanded(!expanded)}>
      <ListChecks size={16} />
      <strong>{label}</strong>
      <span className="session-rules-count" aria-label={`${value.rules.length} active rules`}>{value.rules.length}</span>
      {placement !== 'sidebar' && <span className="session-rules-toggle-label">{expanded ? 'Hide rules' : value.rules.length ? 'Manage rules' : 'Add rules'}</span>}
      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
    <p className="session-rules-description">{description}</p>

    <div id={`${panelId}-rules`} className="session-rules-editor" hidden={!expanded}>
      {value.rules.length > 0 && <ul className="session-rules-list">
        {value.rules.map(rule => <li key={rule.id}>
          {editingId === rule.id ? <div className="session-rule-edit">
            <label htmlFor={`${panelId}-edit`}>Edit rule</label>
            <textarea id={`${panelId}-edit`} value={editingText} onChange={event => setEditingText(event.target.value)} maxLength={MAX_RULE_LENGTH} rows={2} disabled={disabled} autoFocus onKeyDown={event => { if (event.key === 'Escape') setEditingId(null); }} />
            <div className="session-rule-edit-actions">
              <button type="button" className="session-rules-button session-rules-primary" onClick={saveRule} disabled={disabled || !normalized(editingText) || editingText.trim().length > MAX_RULE_LENGTH || editDuplicate}><Check size={14} />Save</button>
              <button type="button" className="session-rules-button session-rules-secondary" onClick={() => setEditingId(null)}>Cancel</button>
              {editDuplicate && <span className="session-rules-hint">This rule already exists.</span>}
            </div>
          </div> : <>
            <span className="session-rule-text">{rule.text}{rule.source === 'learned' && <span className="session-rule-learned" title="Suggested from your choices and approved by you"><Sparkles size={11} />Learned</span>}</span>
            <div className="session-rule-tools">
              <button type="button" className="session-rules-icon-button" aria-label={`Edit rule: ${rule.text}`} title="Edit rule" disabled={disabled} onClick={() => { setEditingId(rule.id); setEditingText(rule.text); }}><Pencil size={14} /></button>
              <button type="button" className="session-rules-icon-button" aria-label={`Remove rule: ${rule.text}`} title="Remove rule" disabled={disabled} onClick={() => onChange({ ...value, rules: value.rules.filter(item => item.id !== rule.id) })}><Trash2 size={14} /></button>
            </div>
          </>}
        </li>)}
      </ul>}
      <div className="session-rules-add">
        <label htmlFor={`${panelId}-new`}>Add your own rule</label>
        <div className="session-rules-add-row">
          <input id={`${panelId}-new`} value={draft} onChange={event => setDraft(event.target.value)} maxLength={MAX_RULE_LENGTH} disabled={disabled || atLimit} placeholder="e.g. Keep interior details sparse and avoid shadows" onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addRule(); } }} />
          <button type="button" className="session-rules-button session-rules-secondary" onClick={addRule} disabled={disabled || atLimit || !normalized(draft) || draftDuplicate}><Plus size={14} />Add rule</button>
        </div>
        {draftDuplicate && <p className="session-rules-hint">This rule already exists.</p>}
      </div>
    </div>

    {atLimit && <p className="session-rules-limit">You have 20 rules. Remove one to add another.</p>}
    {value.suggestions.length > 0 && <div className="session-rules-proposals" aria-label="Rules awaiting your approval">
      <div className="session-rules-proposals-heading"><Sparkles size={14} /><strong>From your choices</strong><span>{value.suggestions.length} to review</span></div>
      {value.suggestions.map(suggestion => <RuleProposal key={`${suggestion.id}:${suggestion.text}`} suggestion={suggestion} disabled={disabled} atLimit={atLimit} existingTexts={existingTexts} onApprove={text => approveSuggestion(suggestion, text)} onDismiss={() => dismissSuggestion(suggestion)} />)}
    </div>}

    {value.feedback.length > 0 && <div className="session-rules-feedback">
      <div><span className="session-rules-verdicts">{acceptedCount} accepted · {rejectedCount} rejected</span><span className="session-rules-feedback-note">AI suggests from your choices. Only approved rules apply.</span></div>
      {aiEnabled && !learning && !error && !value.suggestions.length && <button type="button" className="session-rules-button session-rules-secondary" disabled={disabled} onClick={onRetry}><Sparkles size={13} />Review choices</button>}
    </div>}
    {learning && <div className="session-rules-status" role="status"><LoaderCircle className="session-rules-spinner" size={14} /><span>Learning from your choices…</span></div>}
    {error && <div className="session-rules-error" role="alert"><span>{error}</span>{aiEnabled && <button type="button" className="session-rules-button session-rules-secondary" disabled={disabled || learning} onClick={onRetry}>Try again</button>}</div>}
    {!aiEnabled && value.feedback.length > 0 && <div className="session-rules-status session-rules-connect"><span>Connect AI to suggest rules from your choices.</span><button type="button" className="session-rules-button session-rules-secondary" disabled={disabled} onClick={onConnect}><Sparkles size={13} />Connect AI</button></div>}
  </section>;
}
