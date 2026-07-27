const path = require('node:path');

module.exports = {
  commands: [
    {
      name: 'rsc-build',
      description:
        'Build an RSC server from the client artifacts of a mobile release.',
      options: [
        {
          name: '--client-artifacts <path>',
          description:
            'Path to the RSC client artifacts to build the server for',
          parse: (value) => path.resolve(value),
        },
        {
          name: '--output <path>',
          description: 'Directory where the RSC server build will be written',
          parse: (value) => path.resolve(value),
        },
        {
          name: '--config <path>',
          description: 'Path to an Rspack config file',
          parse: (value) => path.resolve(value),
        },
      ],
      func(...args) {
        return require('./dist/commands/rscBuild.js').rscBuild(...args);
      },
    },
  ],
};
