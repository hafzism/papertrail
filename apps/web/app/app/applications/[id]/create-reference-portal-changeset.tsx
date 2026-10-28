"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "../../../../src/lib/supabase/client";

export function CreateReferencePortalChangeset({ applicationId, documents }: { applicationId: string; documents: Array<{id:string;original_filename:string}> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [applicantType, setApplicantType] = useState("");
  const [kind,setKind]=useState("grant");
  const [centre,setCentre]=useState("");
  const [course,setCourse]=useState("");
  const [location,setLocation]=useState("");
  const [documentIds,setDocumentIds]=useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setError(null);
    if (!name.trim() || !applicantType || !documentIds.length || kind==="exam"&&(!centre||!course) || kind==="renewal"&&!location) { setError("Complete the applicant choices and select at least one fictional supporting document."); return; }
    setSaving(true);
    let data; let rpcError=false;
    try {
      const response=await fetch("/api/browser/reviews",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({applicationId,documentIds,fields:{name:name.trim(),applicantType,kind,...(kind==="exam"?{session:"DEMO-2026-A",centre,course}:{}),...(kind==="renewal"?{location}:{})}})});
      const result=await response.json();data=result.changesetId;rpcError=!response.ok;
    }catch{rpcError=true;}
    setSaving(false);
    if (rpcError || typeof data !== "string") { setError("The demo review envelope could not be created."); return; }
    router.push(`/app/review/${data}`); router.refresh();
  }
  return <form className="mt-5 grid gap-4" noValidate onSubmit={submit}>
    <label className="grid gap-1 text-sm font-semibold">Fictional workflow<select className="min-h-11 border border-[var(--border)] bg-white px-3" value={kind} onChange={event=>setKind(event.target.value)}><option value="grant">Learning support grant</option><option value="exam">Exam registration</option><option value="renewal">Community-service renewal</option></select></label>
    <label className="grid gap-1 text-sm font-semibold">Fictional applicant name<input className="min-h-11 border border-[var(--border)] px-3" maxLength={200} onChange={event=>setName(event.target.value)} value={name} /></label>
    <label className="grid gap-1 text-sm font-semibold">Applicant type<select className="min-h-11 border border-[var(--border)] bg-white px-3" onChange={event=>setApplicantType(event.target.value)} value={applicantType}><option value="">Choose</option><option value="student">Student</option><option value="community-member">Community member</option></select></label>
    {kind==="exam"?<><p className="text-sm">Admission session: DEMO-2026-A. Options below are from the fictional exam form.</p><label className="grid gap-1 text-sm font-semibold">Exam centre<select className="min-h-11 border px-3" value={centre} onChange={event=>setCentre(event.target.value)}><option value="">Choose</option><option>Riverbank Centre</option><option>Hillview Centre</option></select></label><label className="grid gap-1 text-sm font-semibold">Course<select className="min-h-11 border px-3" value={course} onChange={event=>setCourse(event.target.value)}><option value="">Choose</option><option>DEMO101</option><option>DEMO102</option></select></label></>:null}
    {kind==="renewal"?<label className="grid gap-1 text-sm font-semibold">Service location<select className="min-h-11 border px-3" value={location} onChange={event=>setLocation(event.target.value)}><option value="">Choose</option><option>Central Community Hall</option><option>Westside Service Centre</option></select></label>:null}
    <fieldset><legend className="text-sm font-semibold">Fictional evidence to upload</legend>{documents.length?documents.map(document=><label className="mt-2 flex min-h-11 items-center gap-3 border border-[var(--border)] p-3 text-sm" key={document.id}><input type="checkbox" checked={documentIds.includes(document.id)} onChange={event=>setDocumentIds(current=>event.target.checked?[...current,document.id]:current.filter(id=>id!==document.id))}/><span className="break-all">{document.original_filename}</span></label>):<p className="mt-2 text-sm">Add a readable fictional document in the <a className="underline" href="/app/vault">vault</a> first.</p>}</fieldset>
    <p className="text-sm leading-6 text-[var(--slate)]">Review exact values, files and declaration before approval. The isolated browser operates the separate fictional portal.</p>{error ? <p className="text-sm text-red-800" role="alert">{error}</p> : null}<button className="min-h-11 justify-self-start bg-[var(--navy)] px-5 py-3 font-semibold text-white disabled:opacity-60" disabled={saving} type="submit">{saving?"Creating review…":"Prepare fictional portal review"}</button>
  </form>;
}
