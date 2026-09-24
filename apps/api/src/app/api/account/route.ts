import { corsHeaders, jsonError, preflight } from '../../../lib/http/responses.ts';
import { getAdminClient, SupabaseConfigurationError } from '../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['DELETE'], ['Authorization']);

export function OPTIONS(): Response {
  return preflight(headers);
}

// Permanently deletes the signed-in user's account (required by App Store rules).
export async function DELETE(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  try {
    const { error } = await getAdminClient().auth.admin.deleteUser(user.userId);

    if (error) {
      throw error;
    }

    return new Response(null, { status: 204, headers });
  } catch (error) {
    console.error(
      '[account]',
      error instanceof SupabaseConfigurationError ? error.message : 'Account deletion failed.',
    );

    return jsonError('Could not delete your account. Try again later.', 500, headers);
  }
}
