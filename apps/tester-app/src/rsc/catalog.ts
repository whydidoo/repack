export type RscRelease = 'incompatible' | 'release-a' | 'release-b';

interface DeploymentLocation {
  readonly android: string;
  readonly ios: string;
  readonly runtimeVersion: string;
}

const deployments: Readonly<Record<RscRelease, DeploymentLocation>> = {
  'release-a': {
    android: 'http://10.0.2.2:8082',
    ios: 'http://127.0.0.1:8082',
    runtimeVersion: '7',
  },
  'release-b': {
    android: 'http://10.0.2.2:8083',
    ios: 'http://127.0.0.1:8083',
    runtimeVersion: '7',
  },
  incompatible: {
    android: 'http://10.0.2.2:8084',
    ios: 'http://127.0.0.1:8084',
    runtimeVersion: '8',
  },
};

let selectedRelease: RscRelease = 'release-a';

export function getSelectedRscRelease(): RscRelease {
  return selectedRelease;
}

export function selectRscRelease(release: RscRelease): void {
  selectedRelease = release;
}

export function resolveRscDeployment(input: {
  readonly platform: string;
  readonly unit: string;
}): { readonly endpoint: string; readonly runtimeVersion: string } {
  if (input.unit !== 'tester-app') {
    throw new Error(`Unknown RSC unit: ${input.unit}`);
  }
  if (input.platform !== 'android' && input.platform !== 'ios') {
    throw new Error(`Unsupported RSC platform: ${input.platform}`);
  }
  const deployment = deployments[selectedRelease];
  return {
    endpoint:
      input.platform === 'android' ? deployment.android : deployment.ios,
    runtimeVersion: deployment.runtimeVersion,
  };
}
