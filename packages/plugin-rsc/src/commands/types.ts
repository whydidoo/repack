export interface RscBuildArguments {
  readonly clientArtifacts: string;
  readonly config?: string;
  readonly output: string;
}

export interface RscBuildCliConfig {
  readonly platforms: readonly string[];
  readonly reactNativePath: string;
  readonly root: string;
}
