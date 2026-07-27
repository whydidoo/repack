import { createRscClientArtifact } from '../../../artifacts/index.js';
import type {
  RscClientArtifact,
  RscLogicalIdentity,
} from '../../../artifacts/types.js';
import { createRscContractId } from '../../contracts/index.js';
import type {
  RscContractIndex,
  RscIndexedContract,
  RscIndexedContractKind,
} from '../../contracts/types.js';
import { validateRscServerArtifacts } from '../validateRscServerArtifacts.js';

const UNIT = 'widget';
const RUNTIME_VERSION = '7';

describe('validateRscServerArtifacts', () => {
  it('accepts supplied platforms compatible with the current server graph', () => {
    const card = contract('client-reference', 'components/Card.tsx', 'Card');
    const home = contract('root', 'roots/Home.tsx', 'Home');
    const checkMe = contract(
      'server-function',
      'functions/checkMe.ts',
      'checkMe'
    );
    const input = {
      clientReferences: [card],
      roots: [home],
      serverFunctions: [checkMe],
    };

    expect(() =>
      validateRscServerArtifacts({
        clientArtifacts: [artifact('ios', input), artifact('android', input)],
        contractIndex: index(card, home, checkMe),
        unit: UNIT,
      })
    ).not.toThrow();
  });

  it('rejects a current Client Reference missing from a supplied platform artifact', () => {
    const card = contract('client-reference', 'components/Card.tsx', 'Card');
    const ios = artifact('ios', { clientReferences: [card] });
    const android = artifact('android');

    expect(() =>
      validateRscServerArtifacts({
        clientArtifacts: [ios, android],
        contractIndex: index(card),
        unit: UNIT,
      })
    ).toThrow(
      expect.objectContaining({
        code: 'RSC_SERVER_CLIENT_REFERENCE_MISSING',
        identity: card.identity,
        platform: 'android',
      })
    );
    expect(() =>
      validateRscServerArtifacts({
        clientArtifacts: [ios, android],
        contractIndex: index(card),
        unit: UNIT,
      })
    ).toThrow('components/Card.tsx#Card');
  });

  it('requires both the production ID and logical identity of a Client Reference', () => {
    const card = contract('client-reference', 'components/Card.tsx', 'Card');
    const source = artifact('ios', { clientReferences: [card] });
    const forged: RscClientArtifact = {
      ...source,
      platformManifest: {
        ...source.platformManifest,
        clientReferences: source.platformManifest.clientReferences.map(
          (reference) => ({ ...reference, id: 'legacy-client-id' })
        ),
      },
    };

    expect(() =>
      validateRscServerArtifacts({
        clientArtifacts: [forged],
        contractIndex: index(card),
        unit: UNIT,
      })
    ).toThrow(
      expect.objectContaining({
        code: 'RSC_SERVER_CLIENT_REFERENCE_MISSING',
        platform: 'ios',
      })
    );
  });

  it('rejects an artifact root missing from the current server contract index', () => {
    const home = contract('root', 'roots/Home.tsx', 'Home');

    expect(() =>
      validateRscServerArtifacts({
        clientArtifacts: [artifact('ios', { roots: [home] })],
        contractIndex: index(),
        unit: UNIT,
      })
    ).toThrow(
      expect.objectContaining({
        code: 'RSC_SERVER_ROOT_MISSING',
        identity: home.identity,
        platform: 'ios',
      })
    );
    expect(() =>
      validateRscServerArtifacts({
        clientArtifacts: [artifact('ios', { roots: [home] })],
        contractIndex: index(),
        unit: UNIT,
      })
    ).toThrow('roots/Home.tsx#Home');
  });

  it('rejects an artifact Server Function missing from the current server contract index', () => {
    const checkMe = contract(
      'server-function',
      'functions/checkMe.ts',
      'checkMe'
    );

    expect(() =>
      validateRscServerArtifacts({
        clientArtifacts: [artifact('android', { serverFunctions: [checkMe] })],
        contractIndex: index(),
        unit: UNIT,
      })
    ).toThrow(
      expect.objectContaining({
        code: 'RSC_SERVER_FUNCTION_MISSING',
        identity: checkMe.identity,
        platform: 'android',
      })
    );
    expect(() =>
      validateRscServerArtifacts({
        clientArtifacts: [artifact('android', { serverFunctions: [checkMe] })],
        contractIndex: index(),
        unit: UNIT,
      })
    ).toThrow('functions/checkMe.ts#checkMe');
  });
});

function index(...contracts: RscIndexedContract[]): RscContractIndex {
  return { clientEntries: [], contracts };
}

function contract(
  kind: RscIndexedContractKind,
  sourcePath: string,
  exportName: string
): RscIndexedContract {
  return {
    claim: {
      filename: `/project/src/${sourcePath}`,
      location: { column: 0, line: 1 },
    },
    identity: { exportName, sourcePath },
    kind,
    target: {
      exportName,
      filename: `/project/src/${sourcePath}`,
      sourcePath,
    },
  };
}

function artifact(
  platform: 'android' | 'ios',
  input: {
    readonly clientReferences?: readonly RscIndexedContract[];
    readonly roots?: readonly RscIndexedContract[];
    readonly serverFunctions?: readonly RscIndexedContract[];
  } = {}
): RscClientArtifact {
  const addressable = (value: RscIndexedContract) => ({
    id: productionId(value.kind, value.identity),
    identity: value.identity,
  });
  return createRscClientArtifact({
    platform,
    platformManifest: {
      clientReferences: (input.clientReferences ?? []).map((value) => ({
        ...addressable(value),
        target: {
          async: false,
          chunks: [],
          exportName: value.target.exportName,
          moduleId: `${platform}:${value.identity.exportName}`,
        },
      })),
      platform,
      runtimeVersion: RUNTIME_VERSION,
      unit: UNIT,
    },
    roots: (input.roots ?? []).map(addressable),
    runtimeVersion: RUNTIME_VERSION,
    serverFunctions: (input.serverFunctions ?? []).map(addressable),
    unit: UNIT,
  }).value;
}

function productionId(
  kind: RscIndexedContractKind,
  identity: RscLogicalIdentity
): string {
  return createRscContractId({
    identity,
    kind,
    mode: 'production',
    unit: UNIT,
  });
}
