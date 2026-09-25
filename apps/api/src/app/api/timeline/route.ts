import { timelineQuerySchema, timelineResponseSchema } from '@nexui/types';

import { corsHeaders, jsonError, preflight } from '../../../lib/http/responses.ts';
import { getTimelinePage, InvalidCursorError } from '../../../lib/records/queries.ts';
import { getUserClient, SupabaseConfigurationError } from '../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['GET'], ['Authorization']);

export function OPTIONS(): Response {
  return preflight(headers);
}

// Pages through the user's tasks, events and notes, newest first.
export async function GET(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const parsed = timelineQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );

  if (!parsed.success) {
    return jsonError('Invalid timeline request.', 400, headers);
  }

  try {
    const page = await getTimelinePage(getUserClient(user.accessToken), parsed.data);

    return Response.json(timelineResponseSchema.parse(page), { headers });
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      return jsonError('Invalid cursor', 400, headers);
    }

    console.error(
      '[timeline]',
      error instanceof SupabaseConfigurationError ? error.message : 'Loading the timeline failed.',
    );

    return jsonError('Could not load your items. Try again.', 500, headers);
  }
}
