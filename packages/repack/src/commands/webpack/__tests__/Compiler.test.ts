import type { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import type { Reporter } from '../../../logging/types.js';
import { Compiler } from '../Compiler.js';

jest.mock('node:worker_threads', () => {
  const { EventEmitter } =
    jest.requireActual<typeof import('node:events')>('node:events');

  return {
    Worker: jest.fn(() =>
      Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        terminate: jest.fn(() => Promise.resolve(0)),
      })
    ),
  };
});

test('rejects a pending asset request when the worker reports an error', async () => {
  const reporter: Reporter = {
    process: jest.fn(),
    flush: jest.fn(),
    stop: jest.fn(),
  };
  const compiler = new Compiler(
    ['ios'],
    { host: '' },
    reporter,
    '/project',
    '/react-native'
  );

  const request = compiler.getAsset('index.bundle', 'ios');
  const worker = jest.mocked(Worker).mock.results[0].value as EventEmitter;
  const error = new Error('Compilation failed');

  worker.emit('message', { event: 'error', error });

  expect(compiler.resolvers.ios).toHaveLength(0);
  await expect(request).rejects.toBe(error);
});

test('terminates active workers when closed', async () => {
  const reporter: Reporter = {
    process: jest.fn(),
    flush: jest.fn(),
    stop: jest.fn(),
  };
  const compiler = new Compiler(
    ['ios'],
    { host: '' },
    reporter,
    '/project',
    '/react-native'
  );
  const worker = new Worker('worker.js');
  compiler.workers.ios = worker;

  await new Promise<void>((resolve, reject) => {
    compiler.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
