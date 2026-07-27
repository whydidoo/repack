import {
  createMiddleware,
  createServerFn,
} from '@callstack/repack-plugin-rsc/server';
import { checkMeSchema } from './schemas';

const ACTION_HEADER = 'x-tester-check-me';
const ACTION_HEADER_VALUE = 'allowed';

const checkMeHeader = createMiddleware()
  .client(({ next }) =>
    next({ headers: { [ACTION_HEADER]: ACTION_HEADER_VALUE } })
  )
  .server(({ request, next }) => {
    if (request.headers.get(ACTION_HEADER) !== ACTION_HEADER_VALUE) {
      throw new Error('checkMe requires its action-specific header.');
    }
    return next({ context: { checkMeHeader: ACTION_HEADER_VALUE } });
  });

export const checkMe = createServerFn()
  .inputValidator(checkMeSchema)
  .middleware([checkMeHeader])
  .handler(({ context, data }) => ({
    message: `${data.message} (${context.checkMeHeader})`,
    requestId: context.requestId,
  }));
