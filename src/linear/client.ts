/**
 * The transport to Linear's GraphQL API, and what the SDK does not own:
 * classifying its errors into a `kind` the panel can render, and waiting out a
 * rate limit.
 *
 * Documents are sent through this rather than through `LinearClient`'s own
 * methods for two reasons. Its models resolve relations lazily — reading
 * `issue.assignee` off each row of a list is another request per row — and its
 * graphql client calls the global `fetch`, leaving nothing to replay a recorded
 * response through. The seam is the `fetchImpl` argument, defaulted in
 * production. Error parsing stays the SDK's: its classes are the contract.
 *
 * Main process only. The key is a closure argument and never leaves it: SDK and
 * HTTP errors carry request context, including headers, so everything logged or
 * thrown from here is built from the mapped error rather than the raw one.
 */

import {
  parseLinearError,
  AuthenticationLinearError,
  ForbiddenLinearError,
  RatelimitedLinearError,
  UsageLimitExceededLinearError,
  NetworkLinearError,
  InternalLinearError,
} from '@linear/sdk';
import { getLogger } from '../logger';
import type { LinearErrorKind } from './types';

const linearLog = getLogger().scope('linear:client');

export const LINEAR_API_URL = 'https://api.linear.app/graphql';

/** Attempts including the first, and the ceiling on the wait between them. */
const MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 30_000;

/** Linear's ceiling on one query, in complexity points. */
const MAX_QUERY_COMPLEXITY = 10_000;

export class LinearError extends Error {
  constructor(
    readonly kind: LinearErrorKind,
    message: string,
    /** How long until the budget refills, when Linear said. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'LinearError';
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Sends one document and returns its `data`, or throws a `LinearError`. */
export type LinearRequest = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

interface RawGraphQLError {
  message?: string;
  extensions?: { type?: string; code?: string; userPresentableMessage?: string };
}

export function createLinearRequest(apiKey: string, fetchImpl: FetchLike = fetch): LinearRequest {
  return async function request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        return await send<T>(apiKey, fetchImpl, query, variables);
      } catch (error) {
        const failure = error instanceof LinearError ? error : new LinearError('unknown', 'Linear request failed');
        if (attempt >= MAX_ATTEMPTS || !isRetryable(failure.kind)) throw failure;
        const wait = failure.retryAfterMs ?? Math.min(MAX_BACKOFF_MS, 2 ** attempt * 500);
        linearLog.warn('retrying after a failed request', { kind: failure.kind, attempt, waitMs: wait });
        await delay(Math.min(wait, MAX_BACKOFF_MS));
      }
    }
  };
}

async function send<T>(
  apiKey: string,
  fetchImpl: FetchLike,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        // Bare, with no `Bearer` prefix: that prefix is for OAuth tokens, and
        // an API key sent with it comes back as a silent 401.
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new LinearError('network', 'Could not reach Linear.');
  }

  type Body = { data?: T; errors?: RawGraphQLError[] } | null;
  const body: Body = await response
    .json()
    .then((parsed: unknown) => parsed as Body)
    .catch((): Body => null);

  if (response.ok && body?.data && !body.errors?.length) {
    warnIfCostly(response.headers);
    return body.data;
  }

  throw classify(response, body?.errors ?? []);
}

/**
 * A single query may cost at most 10,000 complexity points, and the four-group
 * issue document is the only one here big enough to approach it. Said out loud
 * near the ceiling, so it is known before Linear starts refusing the query.
 */
function warnIfCostly(headers: Headers): void {
  const complexity = Number(headers.get('X-Complexity'));
  if (Number.isFinite(complexity) && complexity > MAX_QUERY_COMPLEXITY * 0.6) {
    linearLog.warn('query is approaching the single-query complexity ceiling', {
      complexity,
      ceiling: MAX_QUERY_COMPLEXITY,
    });
  }
}

/**
 * Exceeding a budget is **HTTP 400 with a `RATELIMITED` code**, not a 429 and
 * with no `Retry-After` — a shape anything watching for 429 misclassifies. The
 * code is checked before the SDK's own parsing for that reason.
 */
function classify(response: Response, errors: RawGraphQLError[]): LinearError {
  const first = errors[0];
  const message = first?.extensions?.userPresentableMessage ?? first?.message ?? `Linear answered ${response.status}.`;

  if (errors.some(isRateLimit)) {
    return new LinearError('rate-limited', message, resetDelay(response.headers));
  }

  const parsed = parseLinearError({
    response: { status: response.status, errors: errors as never },
  });

  if (parsed instanceof RatelimitedLinearError || parsed instanceof UsageLimitExceededLinearError) {
    return new LinearError('rate-limited', message, resetDelay(response.headers));
  }
  if (parsed instanceof AuthenticationLinearError || parsed instanceof ForbiddenLinearError) {
    return new LinearError('unauthorized', 'Linear refused the API key. Check it in Global Settings.');
  }
  if (parsed instanceof NetworkLinearError || parsed instanceof InternalLinearError) {
    return new LinearError('network', 'Linear is not answering. Try again in a moment.');
  }
  return new LinearError('unknown', message);
}

function isRateLimit(error: RawGraphQLError): boolean {
  const marks = [error.extensions?.code, error.extensions?.type, error.message];
  return marks.some((mark) => typeof mark === 'string' && mark.toUpperCase().replace(/[^A-Z]/g, '') === 'RATELIMITED');
}

/**
 * Both reset headers are UTC epoch milliseconds. Whichever budget is further
 * out is the one to wait for; without either, the caller backs off.
 */
function resetDelay(headers: Headers): number | undefined {
  const resets = ['X-RateLimit-Requests-Reset', 'X-RateLimit-Complexity-Reset']
    .map((name) => Number(headers.get(name)))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (resets.length === 0) return undefined;
  return Math.max(0, Math.max(...resets) - Date.now());
}

function isRetryable(kind: LinearErrorKind): boolean {
  return kind === 'rate-limited' || kind === 'network';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
