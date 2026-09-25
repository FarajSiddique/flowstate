import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IntentAction, IntentDecision, SavedItem } from '@nexui/types';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ItemFormSheet } from '@/components/item-form-sheet';
import { ApiError, recordIntentEvent, searchItems } from '@/lib/api';
import { localToday } from '@/lib/form-values';
import { displayItemMeta } from '@/lib/intent-display';
import { fieldsFromDecision, fieldsToAction, type FormFields } from '@/lib/item-fields';
import { colors, fonts } from '@/lib/theme';
import { TIMELINE_KEY } from '@/lib/use-timeline';

const DRAFT_COPY = {
  CREATE_EVENT: { heading: 'New event', action: 'Create event' },
  CREATE_TASK: { heading: 'New task', action: 'Create task' },
  CREATE_NOTE: { heading: 'New note', action: 'Create note' },
  SEARCH: { heading: 'Search', action: 'Search' },
} as const;

// Logs the confirmed draft once (saving CREATE_* items); a search then runs against saved
// items. `logged` flips as soon as the log lands, so a retry after a failed search only
// searches again and closing never logs a dismissal for a confirmed draft.
async function confirmDraft(
  decision: IntentDecision,
  text: string,
  action: IntentAction,
  logged: { current: boolean },
): Promise<SavedItem[] | null> {
  if (!logged.current) {
    await recordIntentEvent({ text, decision, outcome: 'confirmed', action });
    logged.current = true;
  }

  if (action.kind !== 'SEARCH') {
    return null;
  }

  const { items } = await searchItems(action);

  return items;
}

/**
 * Reviews a magic-bar draft. Confirming saves and logs it; closing without
 * confirming logs a dismissal so the app can learn from skipped drafts.
 */
export function DraftSheet({
  decision,
  text,
  onClose,
  onSaved,
}: {
  decision: IntentDecision;
  text: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState(() => fieldsFromDecision(decision));
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<SavedItem[] | null>(null);
  const logged = useRef(false);
  const confirm = useMutation({
    mutationFn: (action: IntentAction) => confirmDraft(decision, text, action, logged),
    onSuccess: (items) => {
      if (items) {
        setResults(items);

        return;
      }

      void queryClient.invalidateQueries({ queryKey: TIMELINE_KEY });
      onSaved();
    },
  });

  if (decision.intent === 'UNKNOWN') {
    return null;
  }

  const copy = DRAFT_COPY[decision.intent];
  const requestError = confirm.error instanceof ApiError ? confirm.error.message : null;
  const error =
    formError ??
    (confirm.error ? (requestError ?? 'Could not save. Check your connection.') : null);

  function submit() {
    const action = fieldsToAction(decision.intent, fields, localToday());

    if (!action.ok) {
      setFormError(action.error);

      return;
    }

    setFormError(null);
    confirm.mutate(action.value);
  }

  function close() {
    if (!logged.current) {
      void recordIntentEvent({ text, decision, outcome: 'dismissed' }).catch(() => undefined);
    }

    onClose();
  }

  return (
    <ItemFormSheet
      layout={decision.intent}
      heading={copy.heading}
      actionLabel={copy.action}
      fields={fields}
      onChangeField={(key: keyof FormFields, value: string) =>
        setFields((current) => ({ ...current, [key]: value }))
      }
      markedFields={new Set(decision.highlights?.map((span) => span.field))}
      error={error}
      busy={confirm.isPending}
      onSubmit={submit}
      onClose={close}
    >
      {results ? (
        <View style={styles.results} accessibilityLiveRegion="polite">
          <Text style={styles.resultsHeading}>
            {results.length ? `${results.length} found` : 'Nothing matched.'}
          </Text>
          {results.map((item) => (
            <View key={`${item.kind}:${item.id}`} style={styles.result}>
              <Text style={styles.resultTitle}>{item.title}</Text>
              <Text style={styles.resultMeta}>{displayItemMeta(item)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ItemFormSheet>
  );
}

const styles = StyleSheet.create({
  results: { marginTop: 24, gap: 12 },
  resultsHeading: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.muted },
  result: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  resultTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  resultMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
});
