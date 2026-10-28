import { notFound, redirect } from "next/navigation";
import { getPublicSupabaseConfig } from "../../../../src/lib/supabase/config";
import { createClient } from "../../../../src/lib/supabase/server";
import { ApproveChangeset } from "./approve-changeset";
import { BrowserExecutionControls } from "./browser-execution-controls";

interface Action {kind?:string;fieldValues?:Record<string,string>;attachmentVersions?:Array<{id:string;filename:string;sha256:string}>;declarations?:Array<{text:string}>;expectedObservation?:string;}
export default async function ReviewChangesetPage({params}:{params:Promise<{id:string}>}){
  if(getPublicSupabaseConfig()===null)redirect("/login");
  const {id}=await params;const client=await createClient();const {data:claims}=await client.auth.getClaims();
  if(!claims)redirect(`/login?next=/app/review/${id}`);
  const {data:change}=await client.from("changesets").select("id,application_id,payload,payload_sha256,state,expires_at").eq("id",id).maybeSingle();
  if(!change)notFound();
  const payload=change.payload as {adapter?:string;destination?:{origin?:string;path?:string};actions?:Action[]};
  const {data:execution}=await client.from("browser_executions").select("id,state,observation,error_code").eq("changeset_id",id).maybeSingle();
  const supported=payload.adapter==="papertrail-reference-v1";
  return <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-10 sm:px-8">
    <a className="font-semibold underline underline-offset-4" href={`/app/applications/${change.application_id}`}>Back to application</a>
    <p className="pt-eyebrow mt-8">Exact action review</p><h1 className="mt-3 text-4xl font-bold tracking-tight">Review and authorize</h1>
    <section className="mt-8 border border-[var(--pt-rule)] bg-white p-6"><h2 className="text-2xl font-bold">Destination</h2><p className="mt-3 break-all font-mono text-sm">{payload.destination?.origin}{payload.destination?.path}</p>{supported?<p className="mt-3 text-sm">Independent fictional demonstration portal. Use fictional evidence only.</p>:null}
      {payload.actions?.map((action,index)=><article className="mt-6 border-t border-[var(--pt-rule)] pt-5" key={index}><h2 className="text-xl font-bold">{action.kind?.replaceAll("_"," ")}</h2><dl className="mt-3 grid gap-3">{Object.entries(action.fieldValues??{}).map(([key,value])=><div key={key}><dt className="text-xs font-bold uppercase">{key}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>{action.attachmentVersions?.length?<><h3 className="mt-5 font-bold">Files to upload</h3><ul className="mt-2 grid gap-3">{action.attachmentVersions.map(file=><li className="break-all text-sm" key={file.id}>{file.filename}<span className="mt-1 block font-mono text-xs">SHA-256: {file.sha256}</span></li>)}</ul></>:null}{action.declarations?.map((declaration,i)=><p className="mt-4 border border-[var(--pt-rule)] p-3 text-sm" key={i}><span className="block font-bold">Declaration</span>{declaration.text}</p>)}<p className="mt-3 text-sm text-[var(--slate)]">Expected: {action.expectedObservation}</p></article>)}
      <p className="mt-6 break-all font-mono text-xs">Payload SHA-256: {change.payload_sha256}</p><p className="mt-2 text-sm">State: {change.state.replaceAll("_"," ")} · Expires {new Date(change.expires_at).toLocaleString()}</p>
      {change.state==="review_required"?<ApproveChangeset changesetId={change.id}/>:null}
      {supported&&(change.state==="approved"||execution)?<BrowserExecutionControls changesetId={change.id} initial={execution}/>:null}
      {!supported&&change.state==="approved"?<p className="mt-5 text-sm">This destination requires human assistance. Open the portal yourself, use your prepared packet and record the resulting receipt; there is no tested automatic adapter for this destination.</p>:null}
      {change.state==="stale"?<p className="mt-5 text-sm" role="alert">The application changed. Return to the application to prepare a current review.</p>:null}
      {change.state==="executed"?<p className="mt-5 text-sm" role="status">The observed fictional portal acknowledgement is recorded with this reviewed payload.</p>:null}
    </section>
  </main>;
}
