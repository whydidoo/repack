import { defineRscServer } from '../index.js';

describe('defineRscServer', () => {
  it('creates an immutable server definition', () => {
    const server = defineRscServer({ createContext: () => ({}) });
    expect(Object.isFrozen(server)).toBe(true);
  });
});
