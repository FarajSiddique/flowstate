import { intentRequestSchema, intentResponseSchema } from '@nexui/types';

import {
  DecisionEngineConfigurationError,
  getDecisionEngine,
} from '../../../lib/decision-engine/index.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = {
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers });
}

export async function POST(request: Request) {
  const user = await verifyRequest(request, headers);
  if (user instanceof Response) {
    return user;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  const parsed = intentRequestSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues.some((issue) => issue.path[0] === 'context')
      ? 'Invalid request context.'
      : 'Enter 3 to 500 characters of text.';
    return Response.json({ error }, { status: 400, headers });
  }

  try {
    const decision = await getDecisionEngine().classifyIntent(parsed.data);
    return Response.json(intentResponseSchema.parse(decision), { headers });
  } catch (error) {
    console.error(
      '[intent]',
      error instanceof DecisionEngineConfigurationError
        ? error.message
        : 'Intent prediction failed unexpectedly.',
    );
    return Response.json(
      { error: 'Intent prediction is temporarily unavailable.' },
      { status: 500, headers },
    );
  }
}
