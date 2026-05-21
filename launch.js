const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const nodeExe = process.execPath;
const serverPath = path.join(__dirname, 'server.js');
const logFile = path.join(__dirname, 'logs', 'server-stdout.log');

// 确保 logs 目录存在
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const out = fs.openSync(logFile, 'w');
const child = spawn(nodeExe, [serverPath], {
  cwd: __dirname,
  detached: true,
  stdio: ['ignore', out, out],
  env: { ...process.env, LOG_LEVEL: 'debug' }
});

child.unref();
console.log('Server started with PID:', child.pid);
console.log('Log file:', logFile);
process.exit(0);
