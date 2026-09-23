import { healthResponseSchema, type HealthResponse } from '@flowstate/types';

export function GET() {
  const body: HealthResponse = { status: 'ok' };

  return Response.json(healthResponseSchema.parse(body), {
    headers: {
      'Cache-Control': 'no-store',
      // This public, credential-free endpoint also supports Expo's web preview.
      'Access-Control-Allow-Origin': '*',
    },
  });
}
