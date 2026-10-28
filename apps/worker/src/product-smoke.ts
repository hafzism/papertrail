import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { encryptApiKey, decryptApiKey, resolveAiCredentialEncryptionSecret } from "./ai-credential-vault.js";
import {smokeFollowupRules} from "./followup-product-smoke.js";

config({ path: resolve(import.meta.dirname,"../../..", ".env"), quiet: true });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{ auth: { persistSession:false,autoRefreshToken:false } });
const sql = postgres(process.env.DATABASE_URL!,{ max:1,connect_timeout:10 });
const owners: string[] = [];
const passed: string[] = [];
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function rpc(client: SupabaseClient,name: string,args: Record<string,unknown>={}) {
  const { data,error } = await client.rpc(name,args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}
async function owner() {
  const password=randomUUID()+randomUUID(); const email=`papertrail-smoke-${randomUUID()}@example.invalid`;
  const { data,error }=await admin.auth.admin.createUser({ email,password,email_confirm:true });
  assert(!error && data.user,`smoke owner creation failed (${error?.status??"no-status"}/${error?.code??"no-code"})`); owners.push(data.user.id);
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{ auth:{persistSession:false,autoRefreshToken:false} });
  const signed=await client.auth.signInWithPassword({email,password});
  assert(!signed.error,"smoke owner sign-in failed");
  return {id:data.user.id,client};
}
try {
  const a=await owner(), b=await owner();
  passed.push(await smokeFollowupRules(sql,a.id));
  const app=await rpc(a.client,"create_application_draft",{p_title:"Fictional completion smoke"});
  const secret=resolveAiCredentialEncryptionSecret();
  for (const provider of ["openai","gemini"]) {
    const fake=`fictional-${provider}-key-${randomUUID()}`;
    await rpc(a.client,"save_owner_ai_provider_credential",{ p_provider:provider,p_model:provider==="openai"?"gpt-5-mini":"gemini-2.5-flash",p_key_ciphertext:encryptApiKey(fake,secret) });
    const status=await rpc(a.client,"owner_ai_provider_credential_status");
    assert(status[0]?.provider===provider && !JSON.stringify(status).includes("ciphertext"),"provider metadata exposed ciphertext");
    const stored=await rpc(admin,"get_owner_ai_provider_credential_for_service",{p_owner_id:a.id});
    assert(decryptApiKey(stored[0].key_ciphertext,secret)===fake,"provider credential round-trip failed");
    assert((await rpc(b.client,"owner_ai_provider_credential_status")).length===0,"cross-owner provider metadata leak");
    const denied=await b.client.rpc("get_owner_ai_provider_credential_for_service",{p_owner_id:a.id});
    assert(denied.error,"owner could read ciphertext service function");
    passed.push(`${provider}: encrypted key save/read/remove and owner isolation`);
    await rpc(a.client,"remove_owner_ai_provider_credential");
  }
  const requestId=randomUUID();
  const turn=await rpc(a.client,"begin_application_assistant_turn",{p_application_id:app,p_message:"What remains?",p_request_id:requestId});
  assert((await rpc(a.client,"begin_application_assistant_turn",{p_application_id:app,p_message:"What remains?",p_request_id:requestId})).id===turn.id,"turn retry was duplicated");
  assert(await rpc(admin,"claim_application_assistant_turn",{p_owner_id:a.id,p_turn_id:turn.id})===true,"turn not claimable");
  assert(await rpc(admin,"claim_application_assistant_turn",{p_owner_id:a.id,p_turn_id:turn.id})===false,"turn claimed twice");
  const foreign=await b.client.rpc("application_assistant_context",{p_application_id:app}); assert(foreign.error,"cross-owner application context leak");
  const own=await rpc(a.client,"application_assistant_context",{p_application_id:app}); assert(own.application.id===app,"assistant missing context");
  passed.push("assistant: scoped context and one-dispatch retry admission");
  const changeset=await rpc(a.client,"create_reference_portal_changeset",{p_application_id:app,p_demo_name:"Demo Applicant",p_applicant_type:"student"});
  assert(await rpc(a.client,"approve_private_changeset",{p_changeset_id:changeset}),"initial changeset approval failed");
  await rpc(a.client,"record_application_fact_override",{p_application_id:app,p_fact_key:"applicant_name",p_value_json:"Corrected Demo Applicant"});
  const changed=await a.client.from("changesets").select("state").eq("id",changeset).single();
  assert(changed.data?.state==="stale","material correction retained approval");
  const late=await rpc(admin,"finish_application_assistant_turn",{p_owner_id:a.id,p_turn_id:turn.id,p_reply:"Old answer"});
  assert(late!=="completed","late assistant answer survived correction");
  passed.push("correction: invalidates approval and rejects late assistant answer");
  const voice=await rpc(a.client,"create_voice_session",{p_application_id:app,p_model_name:"fictional-no-provider-call"});
  await rpc(a.client,"update_voice_session_state",{p_session_id:voice,p_state:"connected"});
  const call={p_session_id:voice,p_task_id:"test-note",p_tool:"save_application_note",p_arguments:{text:"Fictional voice note"}};
  const result=await rpc(a.client,"run_voice_application_tool",call);
  assert((await rpc(a.client,"run_voice_application_tool",call)).noteId===result.noteId,"voice tool replay duplicated note");
  const foreignTool=await b.client.rpc("run_voice_application_tool",call);assert(foreignTool.error,"foreign owner used voice session");
  await rpc(a.client,"update_voice_session_state",{p_session_id:voice,p_state:"closed"});
  assert((await a.client.rpc("run_voice_application_tool",{...call,p_task_id:"late"})).error,"closed voice session dispatched work");
  passed.push("voice: owner-scoped idempotent tools and closed-session denial");
  // This synthetic chat is never contacted by the smoke.
  const chatId=String(-Math.floor(Date.now()));
  const linked=await admin.from("telegram_channel_links").insert({owner_id:a.id,telegram_chat_id:chatId});assert(!linked.error,"synthetic channel setup failed");
  const updateId=Date.now();
  const queue={p_update_id:updateId,p_chat_id:chatId,p_chat_type:"private",p_body:"/applications"};
  assert(await rpc(admin,"queue_telegram_intake",queue)==="queued","Telegram intake not queued");
  assert(await rpc(admin,"queue_telegram_intake",queue)==="duplicate","Telegram update not deduplicated");
  const rows=await sql`update public.jobs set state='running',fencing_token=1,lease_expires_at=now()+interval '90 seconds' where owner_id=${a.id} and kind='process_telegram_intake' returning id`;
  assert(rows[0],"Telegram job not recorded atomically");
  const jobArgs={p_job_id:rows[0].id,p_fencing_token:1,p_action:"begin"};
  const intake=await rpc(admin,"telegram_intake_action",jobArgs);assert(intake.owner_id===a.id,"Telegram owner mismatch");
  const apps=await rpc(admin,"telegram_intake_action",{...jobArgs,p_action:"applications"});assert(apps.length===1 && apps[0].id===app,"Telegram context crossed owners");
  await rpc(a.client,"unlink_telegram_channel");
  assert((await admin.rpc("telegram_intake_action",{...jobArgs,p_action:"applications"})).error,"unlinked chat could still act");
  passed.push("Telegram: durable deduplication, owner scope and unlink fences");
  console.log(JSON.stringify({passed},null,2));
} catch(error) {
  console.error(error instanceof Error?error.message:"product smoke failed");process.exitCode=1;
} finally {
  for (const id of owners) {
    const {error}=await admin.auth.admin.deleteUser(id);
    if(error){ console.error("Smoke owner cleanup failed; inspect test users before retrying.");process.exitCode=1; }
  }
  await sql.end({timeout:3});
}
