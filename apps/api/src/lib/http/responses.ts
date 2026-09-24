/**
 * Response helpers shared by the authenticated API routes. Every response is
 * uncacheable and readable from Expo's web preview.
 *
 * @example
 * const headers = corsHeaders(['POST'], ['Authorization', 'Content-Type']);
 *
 * export function OPTIONS(): Response {
 *   return preflight(headers);
 * }
 *
 * return jsonError('Invalid JSON', 400, headers);
 */

/** Builds the headers a route sends on every response; `OPTIONS` is always allowed. */
export function corsHeaders(methods: string[], allowHeaders: string[]): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': [...methods, 'OPTIONS'].join(', '),
    'Access-Control-Allow-Headers': allowHeaders.join(', '),
  };
}

/** Answers a CORS preflight request. */
export function preflight(headers: HeadersInit): Response {
  return new Response(null, { status: 204, headers });
}

/** Sends the API's error shape, `{ error }`, with a user-safe message. */
export function jsonError(message: string, status: number, headers: HeadersInit): Response {
  return Response.json({ error: message }, { status, headers });
}
