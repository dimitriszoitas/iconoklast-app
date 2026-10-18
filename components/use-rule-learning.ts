'use client';

import { useEffect, useRef, useState } from 'react';
import type { IconItem, Standards } from '../lib/icon-types';
import { normalizeSessionRules, type RuleSuggestion } from '../lib/session-rules';
import { ruleLearningFingerprint } from '../lib/review-decisions';

type Options = {
  items: IconItem[];
  standards: Standards;
  apiKey: string;
  model: string;
  enabled: boolean;
  onSuggestions: (id: string, fingerprint: string, suggestions: RuleSuggestion[]) => void;
};
type Job = { timer: ReturnType<typeof setTimeout>; controller: AbortController };

export default function useRuleLearning(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const jobs = useRef(new Map<string, Job>());
  const [states, setStates] = useState<Record<string, { learning: boolean; error?: string }>>({});

  function cancel(id: string) {
    const job = jobs.current.get(id);
    if (job) { clearTimeout(job.timer); job.controller.abort(); jobs.current.delete(id); }
    setStates(previous => ({ ...previous, [id]: { learning: false } }));
  }

  function request(item: IconItem) {
    cancel(item.id);
    const value = normalizeSessionRules(item.sessionRules);
    if (!latest.current.enabled || !value.feedback.length || value.rules.length >= 20) return;
    const snapshot = latest.current;
    const fingerprint = ruleLearningFingerprint(item, snapshot.standards);
    const aborter = new AbortController();
    const contextCurrent = () => {
      const current = latest.current.items.find(candidate => candidate.id === item.id);
      return latest.current.enabled && !!current && ruleLearningFingerprint(current, latest.current.standards) === fingerprint;
    };
    const stillCurrent = () => !aborter.signal.aborted && contextCurrent();
    setStates(previous => ({ ...previous, [item.id]: { learning: true } }));
    const timer = setTimeout(async () => {
      const timeout = setTimeout(() => aborter.abort(), 50_000);
      try {
        if (!stillCurrent()) return;
        const response = await fetch('/api/rules/suggest', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: aborter.signal,
          body: JSON.stringify({ brief: item.brief, standards: snapshot.standards, rules: value.rules.map(rule => rule.text), feedback: value.feedback, dismissedRules: value.dismissedRules, apiKey: snapshot.apiKey || undefined, model: snapshot.model || undefined }),
        });
        const result = await response.json() as { error?: string | { message?: string }; suggestions?: Omit<RuleSuggestion, 'id'>[] };
        if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || 'Could not suggest a rule. Your decisions are saved.');
        if (!stillCurrent()) return;
        if (!Array.isArray(result.suggestions)) throw new Error('The rule suggestions were incomplete. Try again.');
        const next = normalizeSessionRules({ ...value, suggestions: result.suggestions.map((suggestion: Omit<RuleSuggestion, 'id'>) => ({ ...suggestion, id: crypto.randomUUID() })) });
        latest.current.onSuggestions(item.id, fingerprint, next.suggestions);
      } catch (error) {
        if (jobs.current.get(item.id)?.controller === aborter && contextCurrent()) {
          setStates(previous => ({ ...previous, [item.id]: { learning: false, error: aborter.signal.aborted ? 'Rule suggestions timed out. Your decisions are saved.' : error instanceof Error ? error.message : 'Could not suggest a rule.' } }));
        }
      } finally {
        clearTimeout(timeout);
        if (jobs.current.get(item.id)?.controller === aborter) {
          jobs.current.delete(item.id);
          setStates(previous => ({ ...previous, [item.id]: { ...previous[item.id], learning: false } }));
        }
      }
    }, 900);
    jobs.current.set(item.id, { timer, controller: aborter });
  }

  useEffect(() => {
    const pending = jobs.current;
    setStates({});
    return () => { for (const job of pending.values()) { clearTimeout(job.timer); job.controller.abort(); } pending.clear(); };
  }, [options.enabled, options.apiKey, options.model]);

  return { states, request, cancel };
}
