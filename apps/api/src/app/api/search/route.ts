import { searchQuerySchema, searchResponseSchema } from '@nexui/types';

import { corsHeaders, jsonError, preflight } from '../../../lib/http/responses.ts';
import { searchItems } from '../../../lib/records/queries.ts';
import { getUserClient, SupabaseConfigurationError } from '../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['GET'], ['Authorization']);

export function OPTIONS(): Response {
  return preflight(headers);
}

// Runs a confirmed SEARCH draft against the user's saved items.
export async function GET(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const parsed = searchQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));

  if (!parsed.success) {
    const missingText = parsed.error.issues.some((issue) => issue.path[0] === 'q');

    return jsonError(
      missingText ? 'Enter something to search for.' : 'Invalid search.',
      400,
      headers,
    );
  }

  try {
    const items = await searchItems(getUserClient(user.accessToken), parsed.data);

    return Response.json(searchResponseSchema.parse({ items }), { headers });
  } catch (error) {
    console.error(
      '[search]',
      error instanceof SupabaseConfigurationError ? error.message : 'Search failed.',
    );

    return jsonError('Search is unavailable right now. Try again.', 500, headers);
  }
}
