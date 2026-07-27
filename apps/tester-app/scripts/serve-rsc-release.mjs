import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { toNodeMiddleware } from '@callstack/repack-plugin-rsc/server';

const [directory, portValue] = process.argv.slice(2);
if (!directory || !portValue) {
  throw new Error('Usage: serve-rsc-release.mjs <deployment-directory> <port>');
}

const port = Number(portValue);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid port: ${portValue}`);
}

const deploymentUrl = pathToFileURL(path.resolve(directory, 'server.js')).href;
const deployment = await import(deploymentUrl);
if (typeof deployment.handler !== 'function') {
  throw new Error(`RSC deployment has no handler export: ${deploymentUrl}`);
}

const server = http.createServer(toNodeMiddleware(deployment.handler));
server.listen(port, '0.0.0.0', () => {
  console.log(`Serving ${directory} on http://127.0.0.1:${port}`);
});
