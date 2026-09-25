import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ItemPatch, SavedItem } from '@nexui/types';
import { useState } from 'react';

import { ItemFormSheet } from '@/components/item-form-sheet';
import { ApiError, updateItem } from '@/lib/api';
import { localToday } from '@/lib/form-values';
import { fieldsFromItem, fieldsToPatch, type FormFields } from '@/lib/item-fields';
import { TIMELINE_KEY } from '@/lib/use-timeline';

const EDIT_COPY = {
  task: { heading: 'Edit task', layout: 'CREATE_TASK' },
  event: { heading: 'Edit event', layout: 'CREATE_EVENT' },
  note: { heading: 'Edit note', layout: 'CREATE_NOTE' },
} as const;

// Edits a saved item in the same sheet used for drafts.
export function EditSheet({ item, onClose }: { item: SavedItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState(() => fieldsFromItem(item));
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (patch: ItemPatch) => updateItem(item, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TIMELINE_KEY });
      onClose();
    },
  });
  const copy = EDIT_COPY[item.kind];
  const requestError = save.error instanceof ApiError ? save.error.message : null;
  const error =
    formError ?? (save.error ? (requestError ?? 'Could not save. Check your connection.') : null);

  function submit() {
    const patch = fieldsToPatch(item, fields, localToday());

    if (!patch.ok) {
      setFormError(patch.error);

      return;
    }

    setFormError(null);
    save.mutate(patch.value);
  }

  return (
    <ItemFormSheet
      layout={copy.layout}
      heading={copy.heading}
      actionLabel="Save changes"
      fields={fields}
      onChangeField={(key: keyof FormFields, value: string) =>
        setFields((current) => ({ ...current, [key]: value }))
      }
      error={error}
      busy={save.isPending}
      onSubmit={submit}
      onClose={onClose}
    />
  );
}
