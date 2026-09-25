import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChangeAction, IntentDecision } from '@nexui/types';
import { useRef, useState } from 'react';

import { ItemFormSheet } from '@/components/item-form-sheet';
import { ApiError, recordIntentEvent } from '@/lib/api';
import { localToday } from '@/lib/form-values';
import { fieldsFromChange, fieldsToChange, type FormFields } from '@/lib/item-fields';
import { TIMELINE_KEY } from '@/lib/use-timeline';

const CHANGE_COPY = {
  COMPLETE: { heading: 'Mark done', action: 'Mark done' },
  RESCHEDULE: { heading: 'Move', action: 'Move' },
  APPEND: { heading: 'Add to note', action: 'Add' },
} as const;

/**
 * Adjusts a change before applying it: a new date/time for a move, or the text to add.
 * Closing without confirming logs a dismissal, like the draft sheet.
 */
export function ChangeSheet({
  decision,
  action,
  text,
  onClose,
  onSaved,
}: {
  decision: IntentDecision;
  action: ChangeAction;
  text: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState(() => fieldsFromChange(action));
  const [formError, setFormError] = useState<string | null>(null);
  const logged = useRef(false);
  const confirm = useMutation({
    mutationFn: async (change: ChangeAction) => {
      await recordIntentEvent({
        text,
        decision,
        outcome: 'confirmed',
        action: change,
        via: 'form',
      });
      logged.current = true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TIMELINE_KEY });
      onSaved();
    },
  });
  const copy = CHANGE_COPY[action.kind];
  const requestError = confirm.error instanceof ApiError ? confirm.error.message : null;
  const error =
    formError ??
    (confirm.error ? (requestError ?? 'Could not save. Check your connection.') : null);

  function submit() {
    const change = fieldsToChange(action, fields, localToday());

    if (!change.ok) {
      setFormError(change.error);

      return;
    }

    setFormError(null);
    confirm.mutate(change.value);
  }

  function close() {
    if (!logged.current) {
      void recordIntentEvent({ text, decision, outcome: 'dismissed' }).catch(() => undefined);
    }

    onClose();
  }

  return (
    <ItemFormSheet
      layout={action.kind}
      heading={action.target ? `${copy.heading}: ${action.target.title}` : copy.heading}
      actionLabel={copy.action}
      fields={fields}
      onChangeField={(key: keyof FormFields, value: string) =>
        setFields((current) => ({ ...current, [key]: value }))
      }
      error={error}
      busy={confirm.isPending}
      onSubmit={submit}
      onClose={close}
    />
  );
}
