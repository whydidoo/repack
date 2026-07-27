import { defineRscServer } from '@callstack/repack-plugin-rsc/server';

const server = defineRscServer({
  createContext({ request }) {
    return {
      requestId:
        request.headers.get('x-request-id') ??
        `tester-${Date.now().toString(36)}`,
    };
  },
  onError(error, { digest }) {
    console.error(`[tester-app RSC ${digest}]`, error);
  },
});

declare module '@callstack/repack-plugin-rsc/server' {
  interface Register {
    server: typeof server;
  }
}

export default server;
