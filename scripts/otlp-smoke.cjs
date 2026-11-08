// Local collector verification: real SDK export, no account or credentials.
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const seen = new Map();
const collector = http.createServer((req, res) => {
  let bytes = 0; req.on('data', chunk => { bytes += chunk.length; });
  req.on('end', () => { seen.set(req.url, bytes); res.writeHead(200, {'content-type':'application/json'}); res.end('{}'); });
});
collector.listen(0, '127.0.0.1', () => {
  const script = `const t=require('./telemetry.cjs');t.withStage('snapshot',async()=>t.observe({route:'/api/search',status:200,duration_ms:12,mode:'snapshot',degraded:true})).then(()=>t.shutdownTelemetry()).catch(()=>process.exitCode=1)`;
  const child = spawn(process.execPath, ['--require', './telemetry.cjs', '-e', script], {
    cwd: path.join(__dirname, '../app'),
    env: { PATH: process.env.PATH, NODE_ENV:'test', OTEL_EXPORTER_OTLP_ENDPOINT:`http://127.0.0.1:${collector.address().port}`, OTEL_EXPORTER_OTLP_PROTOCOL:'http/json', OTEL_LOG_LEVEL:'error' },
    stdio: ['ignore','pipe','pipe'],
  });
  let error = ''; child.stderr.on('data', d => { error += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  child.on('exit', code => {
    clearTimeout(timer); collector.close();
    try {
      assert.equal(code, 0, error);
      for (const name of ['/v1/traces','/v1/metrics','/v1/logs']) assert.ok(seen.get(name) > 0, `${name} was not received`);
      console.log(JSON.stringify({collector:'local', signals:[...seen].map(([path,bytes]) => ({path,bytes})), remote_verified:false}));
    } catch (e) { console.error(e.message); process.exitCode = 1; }
  });
});
