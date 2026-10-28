import { createClient } from "@supabase/supabase-js";

export function browserServiceClient(){
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function gatewayRequest(path:string,method="GET",body?:unknown){
  const origin=process.env.BROWSER_GATEWAY_INTERNAL_URL?.trim();const secret=process.env.BROWSER_GATEWAY_SECRET?.trim();
  if(!origin||!secret)throw new Error("BROWSER_GATEWAY_NOT_CONFIGURED");
  const response=await fetch(new URL(path,origin),{method,headers:{"content-type":"application/json","x-papertrail-gateway-secret":secret},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45_000),cache:"no-store"});
  if(response.status===204)return null;
  const result=await response.json();
  if(!response.ok)throw new Error(typeof result.error==="string"?result.error:"BROWSER_GATEWAY_FAILED");
  return result;
}
