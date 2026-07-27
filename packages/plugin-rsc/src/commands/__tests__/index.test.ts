describe('RSC React Native CLI dependency configuration', () => {
  it('auto-registers the rsc-build command', () => {
    const dependencyConfig = require('../../../react-native.config.js') as {
      commands: Array<{
        description: string;
        func: unknown;
        name: string;
        options: Array<{ name: string }>;
      }>;
    };

    expect(dependencyConfig.commands).toEqual([
      expect.objectContaining({
        description:
          'Build an RSC server from the client artifacts of a mobile release.',
        func: expect.any(Function),
        name: 'rsc-build',
        options: [
          expect.objectContaining({ name: '--client-artifacts <path>' }),
          expect.objectContaining({ name: '--output <path>' }),
          expect.objectContaining({ name: '--config <path>' }),
        ],
      }),
    ]);
  });
});
