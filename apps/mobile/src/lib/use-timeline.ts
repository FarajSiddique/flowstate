import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { SavedItem, TimelineResponse } from '@nexui/types';
import { useMemo } from 'react';

import { getTimelinePage, updateItem } from './api';
import { withCompletedAt } from './timeline-pages';

export const TIMELINE_KEY = ['timeline'] as const;

/** The signed-in user's items, newest first, 50 per page. */
export function useTimeline() {
  const query = useInfiniteQuery({
    queryKey: TIMELINE_KEY,
    queryFn: ({ pageParam, signal }) => getTimelinePage(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  return { ...query, items };
}

/** Toggles completion immediately and rolls back if the server refuses. */
export function useCompleteItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ item, completed }: { item: SavedItem; completed: boolean }) =>
      updateItem(item, { completed }),
    onMutate: async ({ item, completed }) => {
      await queryClient.cancelQueries({ queryKey: TIMELINE_KEY });
      const previous = queryClient.getQueryData<InfiniteData<TimelineResponse>>(TIMELINE_KEY);

      queryClient.setQueryData<InfiniteData<TimelineResponse>>(TIMELINE_KEY, (data) =>
        withCompletedAt(data, item, completed ? new Date().toISOString() : null),
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(TIMELINE_KEY, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TIMELINE_KEY }),
  });
}
