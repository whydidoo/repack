import type { RscRuntimeConfig } from '@callstack/repack-plugin-rsc/runtime';
import { resolveRscDeployment } from './catalog';
import { fetchRsc } from './fetchRsc';

const runtime: RscRuntimeConfig = {
  createTransport(context) {
    return {
      fetch(request) {
        const deployment = resolveRscDeployment(context);
        return fetchRsc(deployment.endpoint, request.init);
      },
    };
  },
};

export default runtime;
