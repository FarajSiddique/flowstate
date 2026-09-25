import { intentEventRequestSchema, intentEventResponseSchema } from '@nexui/types';

import { corsHeaders, jsonError, preflight } from '../../../lib/http/responses.ts';
import { recordIntent } from '../../../lib/records/queries.ts';
import { getUserClient, SupabaseConfigurationError } from '../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['POST'], ['Authorization', 'Content-Type']);

export function OPTIONS(): Response {
  return preflight(headers);
}

// Logs a confirmed or dismissed draft; a confirmed task, event or note is saved with it.
export async function POST(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400, headers);
  }

  const parsed = intentEventRequestSchema.safeParse(body);

  if (!parsed.success) {
    const untitled = parsed.error.issues.some((issue) => issue.path.join('.') === 'action.title');

    return jsonError(untitled ? 'Add a title.' : 'Invalid request.', 400, headers);
  }

  try {
    const item = await recordIntent(getUserClient(user.accessToken), parsed.data);

    return Response.json(intentEventResponseSchema.parse({ item }), {
      status: item ? 201 : 200,
      headers,
    });
  } catch (error) {
    console.error(
      '[intent-events]',
      error instanceof SupabaseConfigurationError ? error.message : 'Saving the intent failed.',
    );

    return jsonError('Could not save. Try again.', 500, headers);
  }
}
