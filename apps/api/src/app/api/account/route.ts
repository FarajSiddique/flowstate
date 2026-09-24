import { getAdminClient, SupabaseConfigurationError } from '../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = {
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers });
}

// Permanently deletes the signed-in user's account (required by App Store rules).
export async function DELETE(request: Request) {
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
    return Response.json(
      { error: 'Could not delete your account. Try again later.' },
      { status: 500, headers },
    );
  }
}
