import type { InfiniteData } from '@tanstack/react-query';
import type { SavedItem, TimelineResponse } from '@nexui/types';

/** Returns cached timeline pages without one item (a completed task leaves the list at once). */
export function withoutItem(
  data: InfiniteData<TimelineResponse> | undefined,
  target: Pick<SavedItem, 'kind' | 'id'>,
): InfiniteData<TimelineResponse> | undefined {
  if (!data) {
    return data;
  }

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => item.kind !== target.kind || item.id !== target.id),
    })),
  };
}
