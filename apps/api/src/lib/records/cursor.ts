import { z } from 'zod';

/**
 * Timeline position: the last row's sort key. Opaque to clients.
 *
 * @example
 * encodeCursor({ sortAt: '2026-09-25T15:00:00', id: '0b7c…' }) // 'eyJzb3J0QXQiOi…'
 */
const cursorSchema = z.object({
  sortAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/),
  id: z.uuid(),
});

export type TimelineCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Returns null for anything that isn't a cursor this API issued. */
export function decodeCursor(value: string): TimelineCursor | null {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}
