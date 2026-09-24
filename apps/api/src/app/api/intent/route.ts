import { intentRequestSchema, intentResponseSchema } from '@nexui/types';

import {
  DecisionEngineConfigurationError,
  getDecisionEngine,
} from '../../../lib/decision-engine/index.ts';
import { corsHeaders, jsonError, preflight } from '../../../lib/http/responses.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['POST'], ['Authorization', 'Content-Type']);

export function OPTIONS(): Response {
  return preflight(headers);
}

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

  const parsed = intentRequestSchema.safeParse(body);

  if (!parsed.success) {
    const error = parsed.error.issues.some((issue) => issue.path[0] === 'context')
      ? 'Invalid request context.'
      : 'Enter 3 to 500 characters of text.';

    return jsonError(error, 400, headers);
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

    return jsonError('Intent prediction is temporarily unavailable.', 500, headers);
  }
}
