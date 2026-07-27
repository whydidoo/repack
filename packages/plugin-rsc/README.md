# Re.Pack RSC plugin

> Experimental. This package currently supports Rspack, iOS, Android, and a
> Node.js production server. Its API and artifact format may change between
> Re.Pack releases.

`@callstack/repack-plugin-rsc` integrates React Server Components (RSC) into
an existing Re.Pack application. It discovers RSC declarations from source,
builds the client and server graphs, generates the runtime used by the native
application, serves Flight during development, and creates immutable server
deployment artifacts for production.

The plugin does not own a server URL, router, deployment registry, or fetch
implementation. The application supplies those concerns through its runtime
transport.

## Install and compatibility

Install the plugin together with the React Server DOM bindings used by the
application. React must match the renderer embedded in React Native. For React
Native 0.84, use React 19.2.3 while keeping the security-patched RSDW line:

```sh
pnpm add @callstack/repack-plugin-rsc react-server-dom-webpack@19.2.6 react-dom@19.2.6
pnpm add -D @rspack/core webpack
```

Use a single React installation that is compatible with the renderer shipped
by React Native. The plugin currently accepts:

- `react@>=19.2.3 <19.3.0`;
- `react-server-dom-webpack@>=19.2.6 <19.3.0`;
- `@rspack/core@>=1`;
- Node.js 18 or newer for builds and the production server target.

`react-server-dom-webpack@19.2.6` also declares `react@^19.2.6`,
`react-dom@^19.2.6`, and `webpack@^5.59.0` as its own upstream peers. Those
peers do not encode React Native 0.84's pinned React 19.2.3 renderer. Keep one React
19.2.3 installation and use a package-manager exception scoped only to
`react-server-dom-webpack@19.2.6>react` and `react-dom@19.2.6>react`; do not add
a second React copy or raise React above the native renderer version. For pnpm:

```yaml
peerDependencyRules:
  allowedVersions:
    "react-dom@19.2.6>react": "19.2.3"
    "react-server-dom-webpack@19.2.6>react": "19.2.3"
```

`RscPlugin` validates the installed React and RSDW versions before compilation
and rejects Webpack configurations. Re.Pack does not replace the React version
selected by the application.

## Package entry points

Use each package subpath only in its intended environment:

- `@callstack/repack-plugin-rsc` — build-time `RscPlugin` and configuration
  types;
- `@callstack/repack-plugin-rsc/client` — React Native hooks and typed runtime
  errors;
- `@callstack/repack-plugin-rsc/server` — server declarations, middleware, and
  the Node adapter;
- `@callstack/repack-plugin-rsc/runtime` — application-owned transport types.

Do not import the package root from React Native application code. It loads the
Node-only Rspack plugin.

## Configure Rspack

Add `RscPlugin` to the same Rspack configuration as `RepackPlugin`:

```js
import path from 'node:path';
import * as Repack from '@callstack/repack';
import { RscPlugin } from '@callstack/repack-plugin-rsc';

export default Repack.defineRspackConfig((env) => {
  const { context = Repack.getDirname(import.meta.url), platform } = env;
  if (!platform) throw new Error('Missing platform');

  return {
    context,
    entry: './index.js',
    plugins: [
      new Repack.RepackPlugin({
        platform,
        output: {
          auxiliaryAssetsPath: path.join('build/output', platform, 'remote'),
        },
        extraChunks: [
          // Keep the Flight Client Reference entry with the native release.
          { include: /^widget:client:/, type: 'local' },
          // Preserve the application's policy for its other async chunks.
          {
            exclude: /^widget:client:/,
            type: 'remote',
            outputPath: path.join('build/output', platform, 'remote'),
          },
        ],
      }),
      new RscPlugin({
        name: 'widget',
        runtimeVersion: '7',
        runtime: './src/rsc/rsc.runtime.ts',
        server: {
          roots: ['./src/rsc'],
          setup: './src/rsc/rsc.server.ts',
        },
      }),
    ],
  };
});
```

- `name` is the path-safe identity of one independent RSC unit.
- `runtimeVersion` is an opaque compatibility version for that unit. Bump it
  when a mobile/Flight contract becomes incompatible.
- `runtime` points to the production transport module owned by the
  application.
- `server.roots` are the directories scanned for RSC roots, Server Functions,
  middleware, and Client Components. They also define canonical source paths.
- `server.setup` points to the unit's `defineRscServer` declaration.

Paths are resolved relative to the Rspack context and checked before the build.
`RepackPlugin` may appear before or after `RscPlugin`, but both are required.
The compiler name/platform must be `ios` or `android`.

The local `extraChunks` rule is important for a production native build: the
RSC client entry referenced by Flight must be available to Re.Pack's chunk
loader. Adapt the remaining chunk rules to the application's existing local or
remote chunk policy.

## Application-owned runtime transport

The runtime module exports an `RscRuntimeConfig`. The validation application
resolves a deployment for every request:

```ts
// src/rsc/rsc.runtime.ts
import type { RscRuntimeConfig } from '@callstack/repack-plugin-rsc/runtime';
import { resolveRscDeployment } from './catalog';
import { fetchRsc } from './fetchRsc';

const runtime: RscRuntimeConfig = {
  createTransport(context) {
    return {
      fetch(request) {
        // Resolve here, rather than once at startup, if live update/rollback is
        // controlled by an application-owned catalog.
        const deployment = resolveRscDeployment(context);
        return fetchRsc(deployment.endpoint, request.init);
      },
    };
  },
};

export default runtime;
```

The fixture's adapter adds an application-wide header and uses the platform
fetch. The final call can instead delegate to any fetch-compatible package
that returns a standard `Response`:

```ts
// src/rsc/fetchRsc.ts
const VALIDATION_HEADER = 'x-repack-rsc-validation-app';

export function fetchRsc(
  endpoint: string,
  init: RequestInit
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(VALIDATION_HEADER, 'tester-app');
  return globalThis.fetch(endpoint, { ...init, headers });
}
```

`createTransport` receives immutable metadata:

```ts
type RscTransportContext = Readonly<{
  unit: string;
  runtimeVersion: string;
  platform: string;
  development: boolean;
}>;
```

The transport is initialized lazily once per unit. Concurrent initialization
is deduplicated, a failed initialization may be retried by the next request,
and its optional `dispose` method runs when the unit runtime is disposed. Each
`fetch` receives `{ kind: 'render' | 'action', init: RequestInit }`; preserve
the supplied method, body, headers, and signal when forwarding it.

There is deliberately no `serverUrl`, URL setter, global registry, Nitro
dependency, or required `globalThis.fetch`. Endpoint discovery, authentication,
retry policy, offline behavior, and release selection belong to the
application. Actions are not retried by the plugin.

During development, Re.Pack replaces the application runtime module with a
generated local transport connected to the Re.Pack development server.

## Define the server

The setup module creates request context and central error reporting:

```ts
// src/rsc/rsc.server.ts
import { defineRscServer } from '@callstack/repack-plugin-rsc/server';

const server = defineRscServer({
  createContext({ request }) {
    return {
      requestId:
        request.headers.get('x-request-id') ??
        `widget-${Date.now().toString(36)}`,
    };
  },
  onError(error, { digest }) {
    console.error(`[widget RSC ${digest}]`, error);
  },
});

// Makes context strongly typed in roots, Server Functions, and middleware.
declare module '@callstack/repack-plugin-rsc/server' {
  interface Register {
    server: typeof server;
  }
}

export default server;
```

Compatibility is checked before application context and handlers run.
`onError` is diagnostic only: if it throws, the original failure is preserved.
Production responses redact server details and expose a digest that can be
matched with server logs.

## Define an RSC root

Roots are named top-level declarations created with `defineRscRoot`. A root
with props must provide a Standard Schema validator and a non-empty, static
`reloadOn` list:

```tsx
// src/rsc/TeamRoot.tsx
import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';
import { createElement } from 'react';
import { RscPanel } from './RscPanel';
import { teamPropsSchema } from './schemas';

export const TeamRoot = defineRscRoot({
  props: teamPropsSchema,
  reloadOn: ['teamId'],
  pending: 'retain',
  render({ context, props }) {
    return createElement(RscPanel, {
      requestId: context.requestId,
      teamId: props.teamId,
    });
  },
});
```

The plugin accepts the Standard Schema interface directly and does not require
a particular validation library. A small validator can be written as:

```ts
import type { RscStandardSchemaV1 } from '@callstack/repack-plugin-rsc/server';

interface TeamProps {
  readonly teamId: string;
}

export const teamPropsSchema: RscStandardSchemaV1<unknown, TeamProps> = {
  '~standard': {
    validate(value) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'teamId' in value &&
        typeof value.teamId === 'string' &&
        value.teamId.length > 0
      ) {
        return { value: { teamId: value.teamId } };
      }
      return {
        issues: [
          { message: 'teamId must be a non-empty string', path: ['teamId'] },
        ],
      };
    },
    vendor: 'widget',
    version: 1,
  },
};
```

`reloadOn` accepts schema output fields with primitive identity values:
strings, numbers, booleans, bigints, `null`, or `undefined`. A committed change
to one of those fields starts a new server render. Other prop changes do not
refetch immediately; the latest props are used by the next explicit refresh.

`pending` controls an identity-changing render:

- `retain` (the default) keeps the last successful Flight tree visible;
- `fallback` reveals the nearest Suspense fallback while the next tree loads.

Initial rendering always suspends. Concurrent renders use latest-wins
semantics and superseded work is aborted. A prop-less root can use the shorter
form and needs no schema or `reloadOn`:

```tsx
import { defineRscRoot } from '@callstack/repack-plugin-rsc/server';

export const HealthRoot = defineRscRoot(() => null);
```

Use `useRscRefresh` in a Client Component rendered under the root when a
refresh should be explicit:

```tsx
'use client';

import { useRscRefresh } from '@callstack/repack-plugin-rsc/client';
import { Button, Text, View } from 'react-native';

export function RscPanel(props: { teamId: string }) {
  const refresh = useRscRefresh();

  return (
    <View>
      <Text>{props.teamId}</Text>
      <Button title="Refresh" onPress={() => void refresh()} />
    </View>
  );
}
```

`refresh()` returns `Promise<void>`, retains the last successful tree while it
runs, and does not expose built-in pending/error state. Manage button state and
errors in application code. A superseded refresh rejects with `AbortError`.
Transient refresh failures retain the current tree; fatal compatibility or
protocol failures invalidate it and reach the Error Boundary.

An arbitrary client callback cannot be serialized through Flight. Keep event
handlers in a `'use client'` component, or expose server behavior as a Server
Function.

## Server Functions and per-function headers

`createServerFn` is the only Server Function authoring API. The plugin does not
support `'use server'` directives. A function receives one invocation object on
the client and validated `data`, request `context`, and an `AbortSignal` on the
server:

```ts
// src/rsc/checkMe.ts
import {
  createMiddleware,
  createServerFn,
} from '@callstack/repack-plugin-rsc/server';
import { checkMeSchema } from './schemas';

const HEADER = 'x-check-me';
const VALUE = 'allowed';

const checkMeHeader = createMiddleware()
  .client(({ next }) => next({ headers: { [HEADER]: VALUE } }))
  .server(({ request, next }) => {
    if (request.headers.get(HEADER) !== VALUE) {
      throw new Error('Missing checkMe header.');
    }
    return next({ context: { checkMeHeader: VALUE } });
  });

export const checkMe = createServerFn()
  .inputValidator(checkMeSchema)
  .middleware([checkMeHeader])
  .handler(({ context, data, signal }) => {
    signal.throwIfAborted();
    return {
      message: `${data.message} (${context.checkMeHeader})`,
      requestId: context.requestId,
    };
  });
```

Call the same exported symbol from a Client Component. The compiler replaces
it with the generated client proxy:

```tsx
'use client';

import { checkMe } from './checkMe';

const controller = new AbortController();
const result = await checkMe({
  data: { message: 'hello' },
  signal: controller.signal,
});
```

The client half of function middleware adds headers only to this action. The
server half validates the request and may extend its typed context before the
handler. Use the runtime transport for headers that belong on every render and
action request. Middleware cannot overwrite an existing context key.

All Server Functions use `POST`; there is no public per-function HTTP method.
They do not automatically refresh a root after success. Call `refresh()` when
the application wants new server-rendered data.

## Render in the native application

Import the root declaration normally. The compiler turns it into the client
proxy for the native graph:

```tsx
import { Suspense } from 'react';
import { Text } from 'react-native';
import { RscErrorBoundary } from './RscErrorBoundary';
import { TeamRoot } from './rsc/TeamRoot';

export function TeamScreen({ teamId }: { teamId: string }) {
  return (
    <RscErrorBoundary>
      <Suspense fallback={<Text>Loading…</Text>}>
        <TeamRoot teamId={teamId} />
      </Suspense>
    </RscErrorBoundary>
  );
}
```

Use a React Error Boundary owned by the application. Runtime failures include
`RscCompatibilityError`, `RscRequestError`, and `RscValidationError`, with
matching helpers exported from `/client`:

```ts
import {
  isRscCompatibilityError,
  isRscRequestError,
  isRscValidationError,
} from '@callstack/repack-plugin-rsc/client';
```

Compatibility errors expose `reason`, `expected`, and optional `received`
fields. Request errors expose `code`, `status`, and an optional server `digest`.
Validation errors expose schema `issues`.

## Build and deploy a server release

First build the production mobile bundles. Each platform build emits an
integrity-hashed client contract under:

```text
build/generated/<platform>/rsc/<unit>/<runtimeVersion>/<platform>/client.json
```

Then build the server against the exact client artifacts produced for that
mobile release:

```sh
react-native rsc-build \
  --client-artifacts ./build/generated \
  --output ./build/rsc/releases/release-2026-07-26
```

Use `--config <path>` when the Rspack configuration is not at its normal React
Native CLI location. `rsc-build` loads each supplied platform configuration,
requires exactly one equivalent `RscPlugin` definition, validates the current
server graph against the client contract, and writes a self-contained Node 18
ESM deployment containing:

- `server.js` — the Web `Request -> Promise<Response>` handler;
- `manifests/<platform>.json` — the deployed Client Reference manifests;
- `deployment.json` — unit/runtime coordinates and a SHA-256 file inventory;
- `package.json` — the ESM marker.

Serve the generated handler directly or adapt it to a Node/Connect-style
server:

```js
import http from 'node:http';
import { toNodeMiddleware } from '@callstack/repack-plugin-rsc/server';
import { handler } from './build/rsc/releases/release-2026-07-26/server.js';

http.createServer(toNodeMiddleware(handler)).listen(8082);
```

Behind a trusted proxy, pass `resolveOrigin(request)` to `toNodeMiddleware` and
interpret forwarded headers there. They are intentionally ignored by default.

Deploy the whole output directory atomically and keep it immutable. A server
can be released independently from the mobile binary when `rsc-build`
successfully validates it against that binary's archived `client.json`
artifacts. Point the application-owned catalog at the new endpoint. Rollback
means pointing the catalog back to the previous immutable deployment; neither
operation requires replacing the transport or rebuilding the mobile app.

If a change removes an old root, Server Function, or Client Reference identity,
preserve it with a static named re-export when possible:

```ts
// Keep the old canonical path/export available to deployed mobile clients.
export { TeamRoot } from './team/TeamRoot';
```

`export *` is not supported for RSC contracts. When compatibility cannot be
preserved, bump `runtimeVersion`, produce new client artifacts, and release a
new mobile build before routing it to the new server contract.

## React Native streaming compatibility

The generated client runtime includes two narrow compatibility measures:

- it preserves a host-provided `TextDecoder`, or installs the UTF-8 decoder
  required by Flight when the host has none;
- when a React Native `Response` is buffered and has no `body`, it uses
  `arrayBuffer()` and supplies a local one-part reader to Flight.

The plugin does not install a partial global `ReadableStream` polyfill. A real
streaming response is passed through unchanged and enables progressive Flight
rendering. A buffered response is supported, but it cannot progressively
reveal UI.

## Current limitations

- Rspack only; Webpack is rejected.
- Native platforms are currently limited to iOS and Android.
- The production build target and supplied adapter are Node.js oriented.
- Client Components still require a module-level `'use client'` directive.
- `'use server'` is unsupported; use `createServerFn`.
- Roots and Server Functions must be direct, named, top-level `export const`
  declarations. Default exports and nested declarations are rejected.
- Root `reloadOn` and `pending` options must be statically analyzable.
- Client/server middleware halves may share only statically serializable
  top-level constants.
- RSC contracts cannot use `export *`; use static named re-exports.
- There are no built-in routes, redirects, cookies API, action retries,
  automatic root refresh after actions, or deployment catalog.
- Client callbacks are not serializable RSC props.
- Each Module Federation unit owns its runtime and transport. RSC runtime
  modules and RSDW client modules must not be shared through Module Federation;
  `RscPlugin` rejects conflicting share configuration.

## Troubleshooting

### `Invalid hook call` or `useContext` is `null`

Ensure the application resolves exactly one React copy and that React, React
Native's supported renderer range, and RSDW are compatible. For the supported
React Native 0.84 line, React must remain 19.2.3 even when RSDW and ReactDOM use
the security-patched 19.2.6 release. Inspect the dependency graph with your
package manager (for example, `pnpm why react`) and remove nested or aliased
React copies. Do not configure the RSC client runtime or
`react-server-dom-webpack/client` as Module Federation shared modules.

After changing dependencies or RSC plugin/compiler configuration, completely
stop and restart the Re.Pack development server. An already running compiler
cannot replace its entry/runtime relationship through HMR.

### `ChunkLoadError` for `<unit>:client:<platform>`

Restart the development server first, then confirm the request for
`/<platform>/rsc/<unit>/development/<platform>/client.bundle` returns HTTP 200.
For production, make sure the `RepackPlugin.extraChunks` policy classifies
`/^<unit>:client:/` as local and rebuild the native artifact.

### `TextDecoder` does not exist

The generated RSC client runtime installs its fallback before Flight decoding.
If this still occurs, make sure Client References are loaded through the
generated RSC client entry, clear stale native/dev-server bundles, and restart
the compiler.

### Compatibility error

Check `reason`, `expected`, and `received` on `RscCompatibilityError`. The
client and server must agree on `unit`, `runtimeVersion`, protocol version, and
platform. Do not route a mobile release to a deployment built from another
client artifact set.

### Validation error

Root props and Server Function data are untrusted input. Inspect
`RscValidationError.issues`, fix the Standard Schema or caller payload, and do
not bypass validation in the transport.

### Flight response has no readable body

Return a standard `Response` from the transport. A buffered implementation
must provide a working `arrayBuffer()` so the runtime can create its local
reader. For progressive rendering, use a fetch implementation whose
`Response.body` is a real `ReadableStream<Uint8Array>`.
