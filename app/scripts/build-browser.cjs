const path = require('node:path');
const fs = require('node:fs/promises');
const esbuild = require('esbuild');
const root = path.join(__dirname,'..');
(async()=>{
  await fs.mkdir(path.join(root,'public/generated'),{recursive:true});
  await esbuild.build({entryPoints:[path.join(root,'browser/telemetry-sdk.js')],outfile:path.join(root,'public/generated/telemetry-sdk.js'),bundle:true,minify:true,format:'esm',platform:'browser',target:['es2022'],legalComments:'eof',define:{'process.env':'{}'}});
})().catch(()=>{console.error('Browser telemetry bundle failed to build.');process.exitCode=1;});
