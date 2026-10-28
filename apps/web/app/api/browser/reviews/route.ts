import { NextResponse } from "next/server";
import { createClient } from "../../../../src/lib/supabase/server";

export async function POST(request:Request){
  const client=await createClient();const {data:claims,error:authError}=await client.auth.getClaims();
  if(authError||!claims)return NextResponse.json({error:"unauthorized"},{status:401});
  const body=await request.json().catch(()=>null);
  if(!body||typeof body.applicationId!=="string"||!Array.isArray(body.documentIds)||body.documentIds.some((id:unknown)=>typeof id!=="string"||!/^[0-9a-f-]{36}$/i.test(id))||!body.fields||typeof body.fields!=="object")return NextResponse.json({error:"invalid_review"},{status:400});
  let origin:string;
  try{origin=new URL(process.env.REFERENCE_PORTAL_ORIGIN?.trim()||"http://localhost:3001").origin;}catch{return NextResponse.json({error:"reference_portal_not_configured"},{status:503});}
  const {data,error}=await client.rpc("create_reference_browser_review",{p_application_id:body.applicationId,p_origin:origin,p_fields:body.fields,p_document_ids:body.documentIds});
  return error?NextResponse.json({error:"review_requires_owned_evidence_and_complete_fields"},{status:400}):NextResponse.json({changesetId:data});
}
