import { NextResponse } from "next/server";
import { createClient } from "../../../../../src/lib/supabase/server";
import { browserServiceClient,gatewayRequest } from "../../../../../src/server/browser-gateway";

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  const client=await createClient();const {data:claims}=await client.auth.getClaims();if(!claims)return NextResponse.json({error:"unauthorized"},{status:401});
  const {id}=await params;const {data}=await client.from("browser_executions").select("id,state,observation,error_code").eq("id",id).maybeSingle();
  return data?NextResponse.json(data,{headers:{"cache-control":"no-store"}}):NextResponse.json({error:"not_found"},{status:404});
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const client=await createClient();const {data:claims,error:authError}=await client.auth.getClaims();if(authError||!claims?.claims.sub)return NextResponse.json({error:"unauthorized"},{status:401});
  const {id}=await params;const body=await request.json().catch(()=>null);
  if(!["execute","takeover","resume","reconcile","close"].includes(body?.action))return NextResponse.json({error:"invalid_action"},{status:400});
  const {data:execution}=await client.from("browser_executions").select("id,state,gateway_session_id,changeset_id").eq("id",id).maybeSingle();
  if(!execution?.gateway_session_id)return NextResponse.json({error:"browser_session_unavailable"},{status:409});
  const service=browserServiceClient();const path=`/v1/sessions/${execution.gateway_session_id}`;
  const save=async(values:Record<string,unknown>)=>service.from("browser_executions").update(values).eq("id",id).eq("owner_id",claims.claims.sub);
  try{
    if(body.action==="close"){await gatewayRequest(path,"DELETE");if(execution.state!=="completed")await save({state:"closed"});return NextResponse.json({closed:true});}
    if(body.action==="takeover"){
      if(!["ready","outcome_unknown"].includes(execution.state))return NextResponse.json({error:"takeover_not_available"},{status:409});
      const result=await gatewayRequest(`${path}/takeover-ticket`,"POST",{});await save({state:"human_control"});return NextResponse.json(result);
    }
    if(body.action==="resume"){
      const result=await gatewayRequest(`${path}/resume`,"POST",{});
      await save({state:result.reviewRequired?"outcome_unknown":"ready",observation:result.observation});
      if(result.reviewRequired)await service.from("changesets").update({state:"stale"}).eq("id",execution.changeset_id).eq("owner_id",claims.claims.sub).neq("state","executed");
      return NextResponse.json(result);
    }
    if(body.action==="execute"){
      const {data:authorized}=await client.rpc("authorize_browser_dispatch",{p_execution_id:id});
      if(!authorized)return NextResponse.json({error:"approval_stale_or_already_dispatched"},{status:409});
      try{
        const result=await gatewayRequest(`${path}/execute`,"POST",{actionId:"reference-demo-submit"});
        if(result.result.observation.payloadMatchesApproval!==true)throw new Error("RECEIPT_PAYLOAD_DIFFERS_FROM_APPROVAL");
        const {data:reference,error}=await service.rpc("complete_observed_browser_execution",{p_owner_id:claims.claims.sub,p_execution_id:id,p_reference:result.result.reference,p_observation:result.result.observation});
        if(error)throw new Error("RECEIPT_SAVE_FAILED");return NextResponse.json({reference,state:"completed"});
      }catch{
        await save({state:"outcome_unknown",error_code:"PORTAL_OUTCOME_REQUIRES_RECONCILIATION"});
        return NextResponse.json({error:"outcome_unknown_check_receipt",state:"outcome_unknown"},{status:409});
      }
    }
    if(!["outcome_unknown","dispatching"].includes(execution.state))return NextResponse.json({error:"reconciliation_not_needed"},{status:409});
    const result=await gatewayRequest(`${path}/reconcile`,"POST",{});
    if(!result.observation.reference)return NextResponse.json({error:"no_receipt_observed",observation:result.observation},{status:409});
    if(result.observation.payloadMatchesApproval!==true)return NextResponse.json({error:"receipt_payload_differs_from_approval",observation:result.observation},{status:409});
    const {data:reference,error}=await service.rpc("complete_observed_browser_execution",{p_owner_id:claims.claims.sub,p_execution_id:id,p_reference:result.observation.reference,p_observation:result.observation});
    if(error)return NextResponse.json({error:"receipt_not_recorded"},{status:409});
    return NextResponse.json({reference,state:"completed"});
  }catch{return NextResponse.json({error:"browser_gateway_unavailable"},{status:503});}
}
