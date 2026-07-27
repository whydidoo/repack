module.exports = {
  presets: ['@babel/preset-typescript'],
  plugins: [
    '@babel/plugin-transform-export-namespace-from',
    '@babel/plugin-transform-modules-commonjs',
  ],
  env: {
    test: {
      presets: [['@babel/preset-env', { targets: { node: 18 } }]],
    },
  },
};
