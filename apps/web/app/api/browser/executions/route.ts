import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "../../../../src/lib/supabase/server";
import { browserServiceClient,gatewayRequest } from "../../../../src/server/browser-gateway";

export const runtime="nodejs";
export async function POST(request:Request){
  const client=await createClient();const {data:claims,error:authError}=await client.auth.getClaims();
  if(authError||!claims?.claims.sub)return NextResponse.json({error:"unauthorized"},{status:401});
  const body=await request.json().catch(()=>null);
  if(typeof body?.changesetId!=="string")return NextResponse.json({error:"invalid_changeset"},{status:400});
  const {data:existing}=await client.from("browser_executions").select("id,state").eq("changeset_id",body.changesetId).maybeSingle();
  if(existing)return NextResponse.json({executionId:existing.id,state:existing.state});
  const {data:change}=await client.from("changesets").select("id,application_id,payload,payload_sha256,state").eq("id",body.changesetId).maybeSingle();
  if(!change||change.state!=="approved")return NextResponse.json({error:"approval_required"},{status:403});
  const {data:id,error}=await client.rpc("begin_browser_execution",{p_changeset_id:change.id});
  if(error||!id)return NextResponse.json({error:"approval_expired_or_stale"},{status:409});
  const service=browserServiceClient();
  const {data:claimed}=await service.from("browser_executions").update({creation_claimed:true}).eq("id",id).eq("owner_id",claims.claims.sub).eq("creation_claimed",false).select("id").maybeSingle();
  if(!claimed)return NextResponse.json({executionId:id,state:"starting"});
  let sessionId:string|null=null;
  try{
    const payload=change.payload;const action=payload.actions[0];let total=0;
    const attachments=[];
    for(const file of action.attachmentVersions){
      const {data:version}=await client.from("document_versions").select("object_path,sha256,byte_size").eq("id",file.id).single();
      if(!version||version.sha256!==file.sha256)throw new Error("EVIDENCE_CHANGED");
      total+=Number(version.byte_size);if(total>20*1024*1024)throw new Error("ATTACHMENTS_EXCEED_PORTAL_LIMIT");
      const {data:blob,error:downloadError}=await client.storage.from("private-documents").download(version.object_path);
      if(downloadError||!blob)throw new Error("EVIDENCE_UNAVAILABLE");
      const bytes=Buffer.from(await blob.arrayBuffer());
      if(createHash("sha256").update(bytes).digest("hex")!==file.sha256)throw new Error("EVIDENCE_CHANGED");
      attachments.push({filename:file.filename,mimeType:file.mimeType,sha256:file.sha256,bytesBase64:bytes.toString("base64")});
    }
    const fields=action.fieldValues;
    const result=await gatewayRequest("/v1/sessions","POST",{ownerId:claims.claims.sub,applicationId:change.application_id,runId:id,destination:payload.destination.origin+payload.destination.path,approvedDemoAction:{actionId:action.id,kind:"reference_portal_acknowledgement",applicantName:fields.name,applicantType:fields.applicantType,declarationAccepted:true,payloadSha256:change.payload_sha256,portalFields:fields,attachments}});
    sessionId=result.session.id;
    const observation=await gatewayRequest(`/v1/sessions/${sessionId}/observation`);
    const {error:saveError}=await service.from("browser_executions").update({gateway_session_id:sessionId,state:"ready",observation:observation.observation}).eq("id",id).eq("owner_id",claims.claims.sub);
    if(saveError)throw new Error("BROWSER_SESSION_SAVE_FAILED");
    return NextResponse.json({executionId:id,state:"ready"});
  }catch(error){
    if(sessionId)await gatewayRequest(`/v1/sessions/${sessionId}`,"DELETE").catch(()=>undefined);
    const code=error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)?error.message:"BROWSER_GATEWAY_UNAVAILABLE";
    await service.from("browser_executions").update({state:"failed",error_code:code}).eq("id",id).eq("owner_id",claims.claims.sub);
    return NextResponse.json({error:code,executionId:id},{status:503});
  }
}
