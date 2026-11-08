// Runtime entry gate and contract coverage share this finite route inventory.
// Handler implementations still validate their own parameters and bodies.
const ROUTES = Object.freeze([
  ['GET','/api/search','browser'],
  ['GET','/api/talks/{id}','browser'],
  ['GET','/api/planb/{id}','browser'],
  ['GET','/api/config','browser'],
  ['GET','/api/status','browser'],
  ['GET','/api/alerts','browser'],
  ['POST','/api/interactions','browser'],
  ['POST','/api/subscriptions','browser'],
  ['GET','/api/deps','internal'],
  ['POST','/api/admin/mode','internal'],
  ['GET','/healthz','internal'],
  ['GET','/readyz','internal'],
].map(([method,path,caller])=>Object.freeze({method,path,caller})));

function allowedMethods(pathname) {
  return ROUTES.filter(route=>new RegExp('^'+route.path.replace('{id}','[^/]+')+'$').test(pathname)).map(route=>route.method);
}

module.exports={ROUTES,allowedMethods};
