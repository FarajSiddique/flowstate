import { intentRequestSchema, intentResponseSchema } from '@flowstate/types';

import { decisionEngine } from '../../../lib/decision-engine';

const headers = {
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers });
}

export async function POST(request: Request) {
  let body: unknown;
  
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  const parsed = intentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Enter 3 to 500 characters of text.' }, { status: 400, headers });
  }

  try {
    const decision = await decisionEngine.classifyIntent(parsed.data);
    return Response.json(intentResponseSchema.parse(decision), { headers });
  } catch {
    return Response.json(
      { error: 'Intent prediction is temporarily unavailable.' },
      { status: 500, headers },
    );
  }
}
