#!/usr/bin/env node
/**
 * smoke-pty.mjs — verifies node-pty works in the _app/ sidecar environment.
 * Called by build-sidecar.sh from inside _app/ (cwd = _app/) after npm install.
 * Exits 0 on success, 1 on failure.
 */
import { createRequire } from 'module';
import path from 'path';

// Resolve node-pty from the current working directory (the sidecar _app/ dir).
const require = createRequire(path.join(process.cwd(), 'package.json'));
const { spawn } = require('node-pty');

const pty = spawn('/bin/echo', ['hello'], {
  name: 'xterm',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env,
});

let output = '';
pty.onData((data) => { output += data; });
pty.onExit(() => {
  if (output.trim().includes('hello')) {
    console.log('smoke-pty: ✅ node-pty works — got output:', JSON.stringify(output.trim()));
    process.exit(0);
  } else {
    console.error('smoke-pty: ❌ Expected "hello" in output, got:', JSON.stringify(output));
    process.exit(1);
  }
});

setTimeout(() => {
  console.error('smoke-pty: ❌ Timeout waiting for /bin/echo output');
  process.exit(1);
}, 5000);
