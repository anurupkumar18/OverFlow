const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const {createApp} = require('./src/app');
let observer=null,withStage=(_name,fn)=>fn(),shutdownTelemetry=async()=>{};
try { ({observe:observer,withStage,shutdownTelemetry}=require('./telemetry.cjs'));  } catch { /* Optional when running the bare server. */ }
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'data/catalog.json'),'utf8'));
let es=null;
if(process.env.ES_URL||process.env.ELASTICSEARCH_URL){const {Elasticsearch}=require('./src/elasticsearch');es=new Elasticsearch({env:process.env,withStage});}
const {createStatusProvider}=require('./status-provider.cjs');
const statusProvider=createStatusProvider({env:process.env});
const server=http.createServer(createApp({catalog,es,observer,statusProvider}));
server.requestTimeout=10000;server.headersTimeout=12000;server.keepAliveTimeout=5000;
server.listen(Number(process.env.PORT||8080),()=>console.log(JSON.stringify({event:'listening',port:Number(process.env.PORT||8080),version:process.env.APP_VERSION||'dev'})));
function shutdown(){server.close(async()=>{try{await shutdownTelemetry();}finally{process.exit(0);}});setTimeout(()=>process.exit(0),10000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
