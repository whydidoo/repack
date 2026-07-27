import { createRscContractId } from '../compiler/contracts/index.js';
import {
  areRscLogicalIdentitiesEqual,
  createRscContractIdentityPayload,
  createRscContractSnapshotKey,
  createRscLogicalIdentityKey,
  formatRscContractLabel,
  formatRscLogicalIdentity,
} from '../identity.js';

describe('RSC logical identity', () => {
  const identity = {
    exportName: 'Team',
    sourcePath: 'roots/Team.rsc.tsx',
  };

  it('preserves the canonical key and wire payload encodings', () => {
    expect(createRscLogicalIdentityKey(identity)).toBe(
      '["roots/Team.rsc.tsx","Team"]'
    );
    expect(
      createRscContractIdentityPayload({
        identity,
        kind: 'root',
        unit: 'app',
      })
    ).toBe('["app","root","roots/Team.rsc.tsx","Team"]');
    expect(
      createRscContractId({
        identity,
        kind: 'root',
        mode: 'production',
        unit: 'app',
      })
    ).toBe(
      'rsc_bab820a5c73abc710c2c3e9275f0358c208eca0e03bc07ff5502fee99559901b'
    );
  });

  it('compares identity fields without delimiter ambiguity', () => {
    expect(
      areRscLogicalIdentitiesEqual(
        { exportName: 'b#c', sourcePath: 'a' },
        { exportName: 'c', sourcePath: 'a#b' }
      )
    ).toBe(false);
  });

  it('preserves diagnostic labels and contract snapshot encoding', () => {
    const target = {
      exportName: 'TeamImplementation',
      sourcePath: 'roots/team/Team.rsc.tsx',
    };

    expect(formatRscLogicalIdentity(identity)).toBe('roots/Team.rsc.tsx#Team');
    expect(formatRscContractLabel('root', identity)).toBe(
      'root roots/Team.rsc.tsx#Team'
    );
    expect(
      createRscContractSnapshotKey({ identity, kind: 'root', target })
    ).toBe(
      '["root","roots/Team.rsc.tsx","Team","roots/team/Team.rsc.tsx","TeamImplementation"]'
    );
  });
});
