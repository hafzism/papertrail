import { createHash } from "node:crypto";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { transcribeRecordedAudio } from "@papertrail/ai/assistant";
import { validateRecordedAudio } from "@papertrail/ai/audio";
import { NextResponse } from "next/server";
import { createClient } from "../../../../../src/lib/supabase/server";
import { getOwnerAiProviderCredential } from "../../../../../src/server/ai-provider-credentials";

export const runtime="nodejs";
export async function POST(request: Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const client=await createClient();
  const {data:claims,error:authError}=await client.auth.getClaims();
  if(authError||!claims?.claims.sub)return NextResponse.json({error:"unauthorized"},{status:401});
  const {data:app}=await client.from("applications").select("id").eq("id",id).maybeSingle();
  if(!app)return NextResponse.json({error:"application_not_found"},{status:404});
  const form=await request.formData().catch(()=>null); const file=form?.get("audio"); const requestId=form?.get("requestId");
  if(!(file instanceof File)||file.size<1||file.size>20*1024*1024||typeof requestId!=="string"||!/^[0-9a-f-]{36}$/i.test(requestId))return NextResponse.json({error:"invalid_audio"},{status:400});
  const bytes=new Uint8Array(await file.arrayBuffer());
  let duration:number;
  try{duration=await validateRecordedAudio(bytes,file.type);}catch{return NextResponse.json({error:"audio_must_be_readable_and_under_five_minutes"},{status:400});}
  let credential;
  try{credential=await getOwnerAiProviderCredential(claims.claims.sub);}catch{return NextResponse.json({error:"provider_unavailable"},{status:503});}
  if(!credential)return NextResponse.json({error:"save_provider_in_settings"},{status:409});
  const service=createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const hash=createHash("sha256").update(bytes).digest("hex");
  const {error:admissionError}=await service.from("audio_transcription_requests").insert({id:requestId,owner_id:claims.claims.sub,application_id:id,audio_sha256:hash,duration_seconds:duration});
  if(admissionError){
    const {data:prior}=await client.from("audio_transcription_requests").select("state,transcript,audio_sha256,application_id").eq("id",requestId).maybeSingle();
    if(prior?.state==="completed"&&prior.audio_sha256===hash&&prior.application_id===id)return NextResponse.json({transcript:prior.transcript});
    return NextResponse.json({error:"audio_already_processing"},{status:409});
  }
  try{
    const transcript=await transcribeRecordedAudio(credential,bytes,file.type,file.name,process.env.MODEL_TRANSCRIBE?.trim()||"gpt-transcribe");
    const {error}=await service.from("audio_transcription_requests").update({state:"completed",transcript}).eq("id",requestId).eq("owner_id",claims.claims.sub);
    if(error)throw new Error("transcript_save_failed");
    return NextResponse.json({transcript},{headers:{"cache-control":"no-store"}});
  }catch{
    await service.from("audio_transcription_requests").update({state:"failed"}).eq("id",requestId).eq("owner_id",claims.claims.sub);
    return NextResponse.json({error:"transcription_failed"},{status:502});
  }
}
