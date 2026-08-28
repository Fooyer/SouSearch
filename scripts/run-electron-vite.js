#!/usr/bin/env node
'use strict'

// Some hosts (VS Code's integrated terminal, other Electron-based tools) leak
// ELECTRON_RUN_AS_NODE into child shells. Its mere presence — even set to an
// empty string — makes Electron boot as a plain Node process instead of the
// real app, so `require('electron').app` ends up undefined. Deleting the key
// (not just clearing it) before spawning is the only way to actually unset it
// on every platform.
delete process.env.ELECTRON_RUN_AS_NODE

const { spawn } = require('node:child_process')
const path = require('node:path')

const electronViteDir = path.dirname(require.resolve('electron-vite/package.json'))
const electronViteBin = path.join(electronViteDir, 'bin', 'electron-vite.js')

const child = spawn(process.execPath, [electronViteBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
  } else {
    process.exit(code ?? 0)
  }
})
