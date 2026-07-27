import path from 'node:path';
import { rspack } from '@rspack/core';
import { discoverRscReleaseUnit } from '../internalRscReleaseUnit.js';
import { createRscClientArtifactSet } from '../rsc/artifacts/clientArtifactSet.js';
import { emitRscDeployment } from '../rsc/artifacts/deploymentFiles.js';
import { loadRscClientArtifacts } from '../rsc/artifacts/loadClientArtifacts.js';
import type { RscBuildArguments, RscBuildCliConfig } from './types.js';

export async function rscBuild(
  _: readonly string[],
  cliConfig: RscBuildCliConfig,
  args: RscBuildArguments
): Promise<void> {
  const artifactSet = createRscClientArtifactSet(
    loadRscClientArtifacts(args.clientArtifacts, cliConfig.root)
  );
  const outputPath = path.resolve(cliConfig.root, args.output);
  const releaseUnit = await discoverRscReleaseUnit({
    artifactSet,
    configPath: args.config,
    outputPath,
    projectRoot: cliConfig.root,
    reactNativePath: cliConfig.reactNativePath,
  });
  const compiler = rspack(releaseUnit.serverConfiguration);
  if (!compiler) {
    throw new Error('Rspack did not create an RSC server compiler.');
  }

  await new Promise<void>((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error || closeError) {
          reject(new Error((error ?? closeError)!.message));
          return;
        }
        if (!stats) {
          reject(new Error('Rspack did not return RSC server build stats.'));
          return;
        }
        if (stats.hasErrors()) {
          reject(new Error(stats.toString('errors-only')));
          return;
        }
        resolve();
      });
    });
  });
  emitRscDeployment({
    artifactSet,
    outputPath,
  });
}
