import type { LoaderDefinitionFunction } from '@rspack/core';
import { extractRscDeclarations } from '../compiler/extraction/index.js';
import { RSC_SERVER_LAYER } from './constants.js';
import { isRscSourceLocatedError } from './diagnostics.js';
import { createRscSourceCatalog } from './sourceCatalog.js';

export interface RscLoaderOptions {
  readonly clientReferences?: readonly {
    readonly exportName: string;
    readonly filename: string;
    readonly id: string;
    readonly targetExportName: string;
  }[];
  readonly roots: readonly string[];
  readonly unit: string;
}

const rscLoader: LoaderDefinitionFunction<RscLoaderOptions> = function (
  source,
  inputSourceMap
) {
  const callback = this.async();
  this.cacheable();

  try {
    const layer = (this._module as { layer?: string }).layer;
    const options = this.getOptions();
    const claim = createRscSourceCatalog(options.roots).claim(
      this.resourcePath
    );
    if (!claim) {
      throw new Error(
        `RSC source file is outside configured roots: ${this.resourcePath}`
      );
    }
    const result = extractRscDeclarations({
      clientReferences: options.clientReferences
        ?.filter((reference) => reference.filename === claim.filename)
        .map(({ exportName, id, targetExportName }) => ({
          exportName,
          id,
          targetExportName,
        })),
      filename: claim.filename,
      graph: layer === RSC_SERVER_LAYER ? 'server' : 'client',
      source,
      sourcePath: claim.sourcePath,
      unit: options.unit,
    });
    // Extraction preserves every original line and appends generated imports,
    // so the upstream map remains valid for author-owned source positions.
    callback(null, result.code, inputSourceMap);
  } catch (error) {
    if (isRscSourceLocatedError(error)) {
      this.experiments.emitDiagnostic({
        file: error.filename,
        location: {
          column: error.location.column,
          length: 1,
          line: error.location.line,
        },
        message: error.message,
        severity: 'error',
        sourceCode: source,
      });
      callback(null, source, inputSourceMap);
      return;
    }
    callback(error instanceof Error ? error : new Error(String(error)));
  }
};

export default rscLoader;
export const raw = false;
