import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { SavedTask, TimelineResponse } from '@nexui/types';
import { useMemo } from 'react';

import { getTimelinePage, updateItem } from './api';
import { withoutItem } from './timeline-pages';
import { showCompletionUndo, showUndoStatus } from '@/stores/use-undo-store';

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

/**
 * Completes a task: it leaves the list at once, the server keeps it for 30 days, and the
 * card offers Undo. If the server refuses, the refetch brings the task back (restoring a
 * snapshot could undo a sibling completion that succeeded meanwhile).
 */
export function useCompleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (task: SavedTask) => updateItem(task, { completed: true }),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: TIMELINE_KEY });
      queryClient.setQueryData<InfiniteData<TimelineResponse>>(TIMELINE_KEY, (data) =>
        withoutItem(data, task),
      );
    },
    onSuccess: (_saved, task) => showCompletionUndo(task, `Marked done: ${task.title}`),
    onError: () => {
      showUndoStatus('Could not mark it done. Check your connection.');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TIMELINE_KEY }),
  });
}
