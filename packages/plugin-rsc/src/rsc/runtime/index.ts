/** A single render or Server Function request sent through an RSC transport. */
export type RscTransportRequest = Readonly<{
  kind: 'render' | 'action';
  init: RequestInit;
}>;

/** Application-owned transport used by an RSC unit at runtime. */
export interface RscTransport {
  fetch(request: RscTransportRequest): Promise<Response>;
  dispose?(): void | Promise<void>;
}

/** Immutable metadata supplied while initializing an RSC transport. */
export type RscTransportContext = Readonly<{
  unit: string;
  runtimeVersion: string;
  platform: string;
  development: boolean;
}>;

/** Public shape of an application-owned RSC runtime module. */
export interface RscRuntimeConfig {
  createTransport(
    context: RscTransportContext
  ): RscTransport | Promise<RscTransport>;
}
