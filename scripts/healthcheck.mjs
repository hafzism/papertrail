const targets=[
  ["PaperTrail web",new URL("/api/health",process.env.PAPERTRAIL_WEB_URL||"http://localhost:3000"),"web"],
  ["Reference portal",new URL("/health",process.env.REFERENCE_PORTAL_ORIGIN||"http://localhost:3001"),"papertrail-reference-portal"],
  ["Browser gateway",new URL("/health",process.env.BROWSER_GATEWAY_INTERNAL_URL||"http://localhost:3002"),"browser-gateway"],
];
const results=await Promise.all(targets.map(async([name,url,expected])=>{
  try{const response=await fetch(url,{signal:AbortSignal.timeout(5000)});const body=await response.json();const data=body.data||body;return {service:name,ok:response.ok&&data.service===expected&&data.status==="ok"};}
  catch{return {service:name,ok:false};}
}));
for(const result of results)console.log(`${result.ok?"PASS":"FAIL"} ${result.service}`);
if(results.some(result=>!result.ok))process.exitCode=1;
