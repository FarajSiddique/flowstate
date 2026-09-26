import { itemIdSchema, itemKindSchema, itemPatchSchemas, savedItemSchema } from '@nexui/types';

import { corsHeaders, jsonError, preflight } from '../../../../../lib/http/responses.ts';
import { RecordNotFoundError, updateItem } from '../../../../../lib/records/queries.ts';
import { getUserClient, SupabaseConfigurationError } from '../../../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['PATCH'], ['Authorization', 'Content-Type']);

interface ItemRouteContext {
  params: Promise<{ kind: string; id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

// Edits a saved task, event or note. Tasks can also be marked complete (or not).
export async function PATCH(request: Request, { params }: ItemRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { kind: kindParam, id } = await params;
  const kind = itemKindSchema.safeParse(kindParam);

  if (!kind.success || !itemIdSchema.safeParse(id).success) {
    return jsonError('Item not found.', 404, headers);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400, headers);
  }

  const parsed = itemPatchSchemas[kind.data].safeParse(body);

  if (!parsed.success) {
    const bodyEmpty =
      typeof body === 'object' && body !== null ? Object.keys(body).length === 0 : true;
    const errorSaysNothing = parsed.error.issues.some(
      (issue) => issue.message === 'Nothing to update.',
    );
    const empty = bodyEmpty && errorSaysNothing;

    return jsonError(empty ? 'Nothing to update.' : 'Invalid changes.', 400, headers);
  }

  try {
    const item = await updateItem(getUserClient(user.accessToken), kind.data, id, parsed.data);

    return Response.json(savedItemSchema.parse(item), { headers });
  } catch (error) {
    if (error instanceof RecordNotFoundError) {
      return jsonError('Item not found.', 404, headers);
    }

    console.error(
      '[items]',
      error instanceof SupabaseConfigurationError ? error.message : 'Updating an item failed.',
    );

    return jsonError('Could not save your changes. Try again.', 500, headers);
  }
}
