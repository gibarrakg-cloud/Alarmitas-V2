const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

const children = [];

function start(name, args) {
  const child =
    process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', 'yarn.cmd', ...args], {
          cwd: rootDir,
          stdio: 'inherit',
        })
      : spawn('yarn', args, {
          cwd: rootDir,
          stdio: 'inherit',
        });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[${name}] stopped by signal ${signal}`);
      return;
    }

    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });

  children.push(child);
}

let isShuttingDown = false;

function shutdown(exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGINT');
    }
  }

  setTimeout(() => process.exit(exitCode), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('Starting SnapAlarm API and mobile app...');

start('api', ['dev:api']);
start('mobile', ['dev:mobile']);
