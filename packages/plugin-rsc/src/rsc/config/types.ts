export interface RscServerConfig {
  roots: readonly string[];
  setup: string;
}

export interface RscPluginConfig {
  name: string;
  runtimeVersion: string;
  runtime: string;
  server: RscServerConfig;
}
