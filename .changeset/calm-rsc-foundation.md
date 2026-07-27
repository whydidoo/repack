---
"@callstack/repack-plugin-rsc": minor
---

Add the experimental, Rspack-only `@callstack/repack-plugin-rsc` integration.

The new package provides an explicit `RscPlugin`, client/server/runtime
subpaths, compiler-defined RSC roots and Server Functions, generated Flight
client and server graphs, application-owned transports, immutable client and
deployment artifacts, and an auto-registered `react-native rsc-build` command.
Its React Native runtime includes a guarded UTF-8 `TextDecoder` fallback and a
local reader for buffered responses without requiring a global
`ReadableStream` polyfill.

Flight Client Reference entries are emitted as loadable chunks that reuse the
application graph and its singleton React modules. Generated virtual modules
are isolated from application watch roots, including concurrent iOS and
Android development compilations.

The initial compatibility line requires React `>=19.2.3 <19.3.0` and React
Server DOM Webpack `>=19.2.6 <19.3.0`. Release validation includes a strict
clean installation of the packed plugin, Re.Pack, and dev-server packages.

The plugin integrates through existing Rspack and development-server hooks.
Development routes, child-compiler isolation and Module Federation safeguards
remain package-local and do not change the Re.Pack core or dev-server packages.

The tester application validates development Flight rendering, Server
Function middleware, independent production server releases, explicit root
refresh, and runtime compatibility errors through the standalone plugin.
