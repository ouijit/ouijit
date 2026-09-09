import { describe, test, expect, afterEach, vi } from 'vitest';
import { createLinearRequest, LinearError } from '../linear/client';
import { matchRepoLabel, scopeFilter } from '../linear/scope';

/**
 * Everything here replays a recorded Linear error payload through the injected
 * fetch. The classification is the point: a rate limit arrives as an HTTP 400
 * with a `RATELIMITED` code and no `Retry-After`, which anything watching for a
 * 429 reads as a client error and gives up on.
 */

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const RATE_LIMITED = {
  errors: [
    {
      message: 'Rate limit exceeded',
      extensions: { type: 'ratelimited', code: 'RATELIMITED', userPresentableMessage: 'Slow down.' },
    },
  ],
};

const UNAUTHENTICATED = {
  errors: [{ message: 'Authentication required', extensions: { type: 'authentication error' } }],
};

afterEach(() => {
  vi.useRealTimers();
});

describe('what Linear says going wrong', () => {
  test('a rate limit is recognised through a 400, and waits until the budget refills', async () => {
    vi.useFakeTimers();
    const reset = Date.now() + 4_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(400, RATE_LIMITED, {
          'X-RateLimit-Requests-Reset': String(reset),
          'X-RateLimit-Complexity-Reset': String(reset - 2_000),
        }),
      )
      .mockResolvedValueOnce(response(200, { data: { viewer: { id: 'user-1' } } }));

    const pending = createLinearRequest(
      'lin_api_test',
      fetchImpl,
    )<{ viewer: { id: string } }>('query { viewer { id } }');

    // The later of the two resets, rather than a blind backoff: at three
    // seconds the budget has not refilled and nothing has been asked again.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_100);
    expect((await pending).viewer.id).toBe('user-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('a refused key is not retried, and its message says where to fix it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(401, UNAUTHENTICATED));
    const request = createLinearRequest('lin_api_bad', fetchImpl);

    await expect(request('query { viewer { id } }')).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(request('query { viewer { id } }')).rejects.toThrow(/Global Settings/);
  });

  test('a dropped connection is a network failure, and gives up after three tries', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const pending = createLinearRequest('lin_api_test', fetchImpl)('query { viewer { id } }').catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(10_000);
    const failure = await pending;
    expect(failure).toBeInstanceOf(LinearError);
    expect((failure as LinearError).kind).toBe('network');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  /**
   * An API key takes a bare `Authorization`. The `Bearer` prefix is for OAuth
   * tokens, and getting it wrong is a silent 401 rather than an error worth
   * reading.
   */
  test('the key is sent bare, with no Bearer prefix', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { data: { viewer: { id: 'user-1' } } }));
    await createLinearRequest('lin_api_test', fetchImpl)('query { viewer { id } }');

    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('lin_api_test');
  });
});

describe('scoping a project to Linear', () => {
  test('each kind of scope becomes its own filter fragment', () => {
    // `labels` is a collection filter, so the membership test is `some`. It
    // also accepts a bare `id`, which reads like the same thing and is not.
    expect(scopeFilter({ kind: 'repo-label', labelId: 'label-1', name: 'o/r' })).toEqual({
      labels: { some: { id: { eq: 'label-1' } } },
    });
    expect(scopeFilter({ kind: 'team', teamId: 'team-1', name: 'Engineering' })).toEqual({
      team: { id: { eq: 'team-1' } },
    });
  });

  test('the repo label is matched by name, without case', () => {
    const labels = [
      { id: 'label-1', name: 'Acme/Widgets' },
      { id: 'label-2', name: 'acme/other' },
    ];
    expect(matchRepoLabel(labels, 'acme/widgets')).toEqual({ id: 'label-1', name: 'Acme/Widgets' });
    expect(matchRepoLabel(labels, 'acme/nothing')).toBeUndefined();
    expect(matchRepoLabel(labels, null)).toBeUndefined();
  });
});
