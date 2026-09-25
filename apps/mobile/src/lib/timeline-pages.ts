import type { InfiniteData } from '@tanstack/react-query';
import type { SavedItem, TimelineResponse } from '@nexui/types';

/** Returns cached timeline pages with one item's completion changed (for optimistic updates). */
export function withCompletedAt(
  data: InfiniteData<TimelineResponse> | undefined,
  target: Pick<SavedItem, 'kind' | 'id'>,
  completedAt: string | null,
): InfiniteData<TimelineResponse> | undefined {
  if (!data) {
    return data;
  }

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.kind === target.kind && item.id === target.id ? { ...item, completedAt } : item,
      ),
    })),
  };
}
