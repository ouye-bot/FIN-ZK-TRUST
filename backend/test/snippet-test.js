const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

const backendDir = path.join(__dirname, '..').replace(/\\/g, '/');
console.log('Backend dir:', backendDir);

const code = "const { generateProof } = require('./services/zkService');\ngenerateProof(650, 600, 1).then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e.message); process.exit(1); });";

const absCode = code.replace(/require\('\.\/(.*?)'\)/g, `require('${backendDir}/$1')`);
console.log('Transformed code:\n', absCode);

const tmpFile = path.join(os.tmpdir(), 'snippet_debug.js');
fs.writeFileSync(tmpFile, absCode);
console.log('Written to:', tmpFile);

exec(`node "${tmpFile}"`, { timeout: 30000 }, (err, stdout, stderr) => {
  if (err) console.log('ERROR:', stderr || err.message);
  else console.log('OUTPUT:', stdout.substring(0, 200));
});
