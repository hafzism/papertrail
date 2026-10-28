import { randomUUID,createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import postgres from "postgres";
import { WorkerRepository,type SqlExecutor,type ClaimedJob } from "@papertrail/db";
import { ExtractDocumentHandler } from "./extract-document.js";

config({path:resolve(import.meta.dirname,"../../..", ".env"),quiet:true});
const origin=process.env.PAPERTRAIL_SMOKE_ORIGIN||"http://127.0.0.1:3010";
const portal=process.env.PAPERTRAIL_SMOKE_PORTAL||"http://127.0.0.1:3001";
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const sql=postgres(process.env.DATABASE_URL!,{max:1,connect_timeout:10});
const cookies=new Map<string,string>();
const ownerClient=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(cookie=>cookies.set(cookie.name,cookie.value))}});
let ownerId:string|null=null;let objectPath:string|null=null;let versionId:string|null=null;const executionIds:string[]=[];
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
async function rpc(name:string,args:Record<string,unknown>){const {data,error}=await ownerClient.rpc(name,args);if(error)throw new Error(`${name}: ${error.message}`);return data;}
async function api(path:string,body?:unknown){const response=await fetch(origin+path,{method:body===undefined?"GET":"POST",headers:{cookie:[...cookies].map(([name,value])=>`${name}=${value}`).join("; "),"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();return {response,data};}
try{
  const email=`papertrail-browser-${randomUUID()}@example.invalid`;const password=randomUUID()+randomUUID();
  const {data:created,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});assert(!error&&created.user,`test owner creation failed: ${error?.message??"no user returned"}`);ownerId=created.user.id;
  assert(!(await ownerClient.auth.signInWithPassword({email,password})).error,"test owner sign-in failed");
  const app=await rpc("create_application_draft",{p_title:"Fictional browser completion smoke"});
  const bytes=await readFile(resolve(import.meta.dirname,"../../../tests/fixtures/showcase/ordinary-english-acroform.pdf"));
  objectPath=`intake/smoke-${randomUUID()}/fictional-form.pdf`;
  assert(!(await ownerClient.storage.from("private-documents").upload(objectPath,bytes,{contentType:"application/pdf"})).error,"fixture upload failed");
  const intake=await rpc("create_document_intake",{p_label:"Fictional browser evidence",p_document_type:"demo",p_object_path:objectPath,p_sha256:createHash("sha256").update(bytes).digest("hex"),p_original_filename:"fictional-form.pdf",p_mime_type:"application/pdf",p_byte_size:bytes.byteLength});
  versionId=intake[0].document_version_id;
  const jobs=await sql`update public.jobs set state='running',fencing_token=1,lease_expires_at=now()+interval '90 seconds' where id=${intake[0].job_id} and owner_id=${ownerId} returning *`;
  const repository=new WorkerRepository({async unsafe(query,parameters){return await sql.unsafe(query,parameters as never[]) as never;}} as SqlExecutor);
  const extracted=await new ExtractDocumentHandler(repository,admin).handle(jobs[0] as unknown as ClaimedJob);assert(extracted.state==="succeeded","real extraction worker failed");
  await repository.finish(intake[0].job_id,1n,"succeeded");
  const results=[];
  for(const kind of ["grant","exam","renewal"]){
    const beforeResponse=await fetch(portal+"/operator",{method:"POST",headers:{"x-demo-operator-secret":process.env.PAPERTRAIL_SMOKE_OPERATOR_SECRET||"fictional-local-smoke-only"},body:new URLSearchParams({fault:"none"})});
    assert(beforeResponse.ok,"independent portal verification unavailable");
    const before=await beforeResponse.json();
    if(kind==="exam"){
      const operator=await fetch(portal+"/operator",{method:"POST",headers:{"x-demo-operator-secret":process.env.PAPERTRAIL_SMOKE_OPERATOR_SECRET||"fictional-local-smoke-only"},body:new URLSearchParams({fault:"timeout_once"})});assert(operator.ok,"fault injection unavailable on local test portal");
    }
    const fields={name:"Fictional Test Applicant",applicantType:kind==="renewal"?"community-member":"student",kind,...(kind==="exam"?{session:"DEMO-2026-A",centre:"Riverbank Centre",course:"DEMO101"}:{}),...(kind==="renewal"?{location:"Westside Service Centre"}:{})};
    const review=await api("/api/browser/reviews",{applicationId:app,fields,documentIds:[versionId]});assert(review.response.ok,`review creation failed: ${JSON.stringify(review.data)}`);
    const changesetId=review.data.changesetId;
    assert(await rpc("approve_private_changeset",{p_changeset_id:changesetId}),"browser approval failed");
    const opening=await api("/api/browser/executions",{changesetId});assert(opening.response.ok,`browser session failed: ${JSON.stringify(opening.data)}`);const executionId=opening.data.executionId;executionIds.push(executionId);
    let execution=await api(`/api/browser/executions/${executionId}`,{action:"execute"});
    if(kind==="exam"){
      assert(execution.data.state==="outcome_unknown",`timeout did not produce a reconcilable state: ${JSON.stringify(execution.data)}`);
      execution=await api(`/api/browser/executions/${executionId}`,{action:"reconcile"});
    }
    assert(execution.response.ok && /^DEMO-/.test(execution.data.reference),`observed receipt missing: ${JSON.stringify(execution.data)}`);
    const retry=await api(`/api/browser/executions/${executionId}`,{action:"execute"});assert(retry.response.status===409,"completed submission was dispatched again");
    const afterResponse=await fetch(portal+"/operator",{method:"POST",headers:{"x-demo-operator-secret":process.env.PAPERTRAIL_SMOKE_OPERATOR_SECRET||"fictional-local-smoke-only"},body:new URLSearchParams({fault:"none"})});
    const after=await afterResponse.json();assert(after.submissions===before.submissions+1,"independent portal recorded duplicate submissions");
    const rows=await ownerClient.from("reference_portal_receipts").select("reference_code").eq("changeset_id",changesetId);assert(rows.data?.length===1 && rows.data[0]?.reference_code===execution.data.reference,"durable observed receipt mismatch");
    await api(`/api/browser/executions/${executionId}`,{action:"close"});
    results.push(`${kind}: approved fields + actual upload + observed persistent receipt${kind==="exam"?"; timeout reconciled without resubmission":""}`);
  }
  console.log(JSON.stringify({passed:results},null,2));
}catch(error){console.error(error instanceof Error?error.message:"browser smoke failed");process.exitCode=1;}
finally{
  for(const id of executionIds)await api(`/api/browser/executions/${id}`,{action:"close"}).catch(()=>undefined);
  if(objectPath)await admin.storage.from("private-documents").remove([objectPath]);
  if(versionId){const {data}=await admin.from("document_extractions").select("text_object_path").eq("document_version_id",versionId).maybeSingle();if(data?.text_object_path)await admin.storage.from("private-artifacts").remove([data.text_object_path]);}
  if(ownerId){const {error}=await admin.auth.admin.deleteUser(ownerId);if(error){console.error("Synthetic owner cleanup failed.");process.exitCode=1;}}
  await sql.end({timeout:3});
}
