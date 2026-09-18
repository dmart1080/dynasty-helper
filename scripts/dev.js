/**
 * Cross-platform dev launcher: runs the API and the Vite client together.
 *
 * The obvious "npm run dev --workspace=server & npm run dev --workspace=client"
 * only works on a Unix shell. npm runs scripts through cmd.exe on Windows,
 * where `A & B` is SEQUENTIAL — the server would start, block forever, and the
 * client would never launch. Spawning both from Node works the same everywhere
 * and needs no extra dependency.
 */
import { spawn } from 'node:child_process';

// npm is a .cmd shim on Windows and must be named with the extension.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const TARGETS = [
  { name: 'api', color: '\x1b[36m', args: ['run', 'dev', '--workspace=server'] },
  { name: 'web', color: '\x1b[35m', args: ['run', 'dev', '--workspace=client'] },
];
const RESET = '\x1b[0m';
const width = Math.max(...TARGETS.map((t) => t.name.length));

const children = [];
let shuttingDown = false;

function stopAll(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
  }
  process.exit(code);
}

for (const target of TARGETS) {
  const child = spawn(npm, target.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    // cmd.exe needs a shell to resolve the .cmd shim on some Windows setups.
    shell: process.platform === 'win32',
  });
  children.push(child);

  const label = `${target.color}${target.name.padEnd(width)}${RESET} │ `;
  const relay = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) out.write(`${label}${line}\n`);
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);

  child.on('error', (err) => {
    console.error(`${label}failed to start: ${err.message}`);
    if (err.code === 'ENOENT') console.error(`${label}is npm on your PATH?`);
    stopAll(1);
  });

  // If either process dies the other is useless on its own, so stop both.
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`${label}exited with code ${code}. Stopping the other process.`);
      stopAll(code ?? 1);
    }
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopAll(0));

console.log(`Starting API and client. Press Ctrl+C to stop both.\n`);
