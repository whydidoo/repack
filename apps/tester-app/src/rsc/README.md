# RSC validation flow

This fixture keeps deployment discovery in application code. Re.Pack receives
no server URL or Feature Catalog registry. The long-lived unit transport calls
`resolveRscDeployment` for every request, so changing the catalog target does
not require a mobile rebuild or transport replacement.

## Development

Run the normal Rspack development command and launch either native app:

```sh
pnpm start
pnpm ios
```

The generated development transport bypasses `rsc.runtime.ts` and uses the
private RSC plugin route hosted by the Re.Pack development server.

## Production update and rollback

Build the immutable iOS and Android client artifacts once, then build two
server-only releases from those same artifacts:

```sh
pnpm rsc:build:clients
pnpm rsc:build:release-a
pnpm rsc:build:release-b
```

Serve each release in a separate terminal:

```sh
pnpm rsc:serve:release-a
pnpm rsc:serve:release-b
```

The validation UI switches its host-owned catalog between ports `8082` and
`8083`. Selecting release B demonstrates an independent server update;
selecting release A again demonstrates rollback. On a physical device, replace
the fixture locations in `catalog.ts` with reachable host URLs. Android
emulators use `10.0.2.2`; iOS simulators use `127.0.0.1`.

## Compatibility error

To create a deliberately incompatible server, build temporary version-8
client artifacts and then its server release:

```sh
REPACK_RSC_RUNTIME_VERSION=8 pnpm rsc:build:clients
REPACK_RSC_RUNTIME_VERSION=8 REPACK_RSC_RELEASE=incompatible \
  react-native rsc-build --client-artifacts build/generated \
  --output build/rsc/releases/incompatible
pnpm rsc:serve:incompatible
```

Run the default version-7 mobile bundle and select `Version mismatch`. The
server rejects the request before application code and the Error Boundary
renders the typed compatibility reason. Rebuild the default client artifacts
before producing release A or B again if the version-8 command overwrote them.
