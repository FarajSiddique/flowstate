import { itemIdSchema, undoResponseSchema } from '@nexui/types';

import { corsHeaders, jsonError, preflight } from '../../../../../lib/http/responses.ts';
import {
  RecordNotFoundError,
  undoIntent,
  UndoRefusedError,
} from '../../../../../lib/records/queries.ts';
import { getUserClient, SupabaseConfigurationError } from '../../../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['POST'], ['Authorization']);

interface UndoRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

// Reverses an instant save or change from the Undo card.
export async function POST(request: Request, { params }: UndoRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { id } = await params;

  if (!itemIdSchema.safeParse(id).success) {
    return jsonError('Not found.', 404, headers);
  }

  try {
    const item = await undoIntent(getUserClient(user.accessToken), id);

    return Response.json(undoResponseSchema.parse({ item }), { headers });
  } catch (error) {
    if (error instanceof RecordNotFoundError) {
      return jsonError('Not found.', 404, headers);
    }

    if (error instanceof UndoRefusedError) {
      return jsonError(error.message, 409, headers);
    }

    console.error(
      '[undo]',
      error instanceof SupabaseConfigurationError ? error.message : 'Undoing an intent failed.',
    );

    return jsonError('Could not undo. Try again.', 500, headers);
  }
}
