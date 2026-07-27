import { createMiddleware } from '../index.js';
import {
  prepareRscServerMiddleware,
  runPreparedServerMiddleware,
} from '../middleware.js';

describe('createMiddleware', () => {
  it('runs server middleware in onion order', async () => {
    const events: string[] = [];
    const logging = createMiddleware().server(async ({ next }) => {
      events.push('logging before');
      const result = await next();
      events.push('logging after');
      return result;
    });
    const auth = createMiddleware().server(async ({ next }) => {
      events.push('auth before');
      const result = await next();
      events.push('auth after');
      return result;
    });

    await runPreparedServerMiddleware(
      prepareRscServerMiddleware([logging, auth]),
      {
        context: {},
        request: new Request('https://example.test/rsc'),
        signal: new AbortController().signal,
      },
      async () => {
        events.push('handler');
        return 'done';
      }
    );

    expect(events).toEqual([
      'logging before',
      'auth before',
      'handler',
      'auth after',
      'logging after',
    ]);
  });

  it('rejects duplicate context keys deterministically', async () => {
    const first = createMiddleware().server(({ next }) =>
      next({ context: { viewerId: 'first' } })
    );
    const second = createMiddleware().server(({ next }) =>
      next({ context: { viewerId: 'second' } })
    );

    await expect(
      runPreparedServerMiddleware(
        prepareRscServerMiddleware([first, second]),
        {
          context: {},
          request: new Request('https://example.test/rsc'),
          signal: new AbortController().signal,
        },
        async () => 'unreachable'
      )
    ).rejects.toThrow(
      'RSC middleware cannot overwrite context key "viewerId".'
    );
  });
});
