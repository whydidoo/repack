import { useContext } from 'react';
import { useRscRefresh } from '../index.js';

jest.mock('react', () => ({
  createContext: jest.fn(() => ({ Provider: Symbol('RscRefreshProvider') })),
  useContext: jest.fn(),
}));

const mockUseContext = jest.mocked(useContext);

describe('useRscRefresh', () => {
  it('returns the refresh function from the nearest root instance', () => {
    const refresh = jest.fn(async () => undefined);
    mockUseContext.mockReturnValue(refresh);

    expect(useRscRefresh()).toBe(refresh);
  });

  it('fails clearly when called outside an RSC root', () => {
    mockUseContext.mockReturnValue(null);

    expect(() => useRscRefresh()).toThrow(
      'useRscRefresh() must be used inside a rendered RSC root.'
    );
  });
});
