import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const port = Number(process.env.REFERENCE_PORTAL_PORT || 3001);
const directory=resolve(process.env.REFERENCE_PORTAL_DATA_DIR || "../../data/reference-portal");
mkdirSync(directory,{recursive:true});
const db=new DatabaseSync(resolve(directory,"portal.sqlite"));
db.exec(`pragma journal_mode=WAL;
create table if not exists drafts(id text primary key,session text not null,kind text not null,fields text not null,files text not null default '[]',created_at text not null);
create table if not exists submissions(id text primary key,draft_id text not null unique,reference text not null unique,kind text not null,fields text not null,files text not null,created_at text not null);
create table if not exists uploads(draft_id text not null,sha256 text not null,filename text not null,mime_type text not null,bytes blob not null,primary key(draft_id,sha256));
create table if not exists settings(key text primary key,value text not null);
insert or ignore into settings values('revision','R1');insert or ignore into settings values('fault','none');`);
const centres=["Riverbank Centre","Hillview Centre"];
const locations=["Central Community Hall","Westside Service Centre"];
const courses=["DEMO101","DEMO102"];
const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const revision=()=>String(db.prepare("select value from settings where key='revision'").get()?.value || "R1");

function html(response:ServerResponse,title:string,body:string,status=200){
  response.writeHead(status,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · PaperTrail fictional portal</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f5f3;color:#151515;font:17px/1.6 system-ui}header,main{max-width:820px;margin:auto;padding:24px}header{border-bottom:1px solid #bbb}nav{display:flex;gap:24px;flex-wrap:wrap}h1{font-size:32px;line-height:1.2}label{display:grid;gap:6px;margin:16px 0}input,select,button{font:inherit;min-height:44px;padding:8px 12px;border:1px solid #aaa;background:white}button{background:#161616;color:white;cursor:pointer}a{color:inherit}form,article{background:white;padding:24px;border:1px solid #ccc;margin:20px 0}.notice{padding:12px;border:1px solid #999;font-size:14px}.error{color:#922}dl dt{font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><header><p class="notice">FICTIONAL DEMONSTRATION ONLY · No government or institution affiliation. Use fictional applicant data.</p><nav><a href="/">Portal home</a><a href="/notices">Published demo notices</a><a href="/status">Check receipt</a></nav></header><main><h1>${esc(title)}</h1>${body}</main></html>`);
}
function redirect(res:ServerResponse,path:string){res.writeHead(303,{location:path});res.end();}
function session(req:IncomingMessage,res:ServerResponse){
  const existing=/\bpapertrail_demo_session=([a-f0-9]{48})/.exec(req.headers.cookie||"")?.[1];
  if(existing)return existing;
  const token=randomBytes(24).toString("hex");res.setHeader("set-cookie",`papertrail_demo_session=${token}; HttpOnly; SameSite=Lax; Path=/`);return token;
}
async function data(req:IncomingMessage){
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>21*1024*1024)throw new Error("Upload exceeds 20 MB.");chunks.push(Buffer.from(chunk));}
  const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(typeof value==="string")headers.set(key,value);
  return new Request("http://reference.local/",{method:"POST",headers,body:Buffer.concat(chunks)}).formData();
}
interface Draft {id:string;session:string;kind:string;fields:string;files:string;}
function draftFor(id:string,owner:string):Draft|null{return db.prepare("select * from drafts where id=? and session=?").get(id,owner) as unknown as Draft|null;}
function noticeText(kind:string){
  if(kind==="exam")return "Fictional exam registration for program DEMO-BA, admission session DEMO-2026-A, term 1. Choose Riverbank Centre or Hillview Centre, and DEMO101 or DEMO102. Deadline 2026-11-15, time not specified. Applies only to confirmed enrolled learners in the stated session.";
  if(kind==="renewal")return "Fictional community-service registration renewal for period DEMO-2027. Choose Central Community Hall or Westside Service Centre. Existing DEMO-2026 registrants may prepare a new application with identity/address evidence. Renewal window opens 2026-11-01, closes 2026-11-30; cutoff time not specified. A prior expiry date alone does not establish the window is open.";
  return `Malabar Learning Support Grant — Demonstration Only. Issuer: PaperTrail Demo Learning Centre. Cycle DEMO-2026. ${revision()}: provide name, enrollment evidence, an income certificate issued on or after ${revision()==="R2"?"2026-04-01":"2025-04-01"}, and a JPEG photo up to 200 KB. Deadline ${revision()==="R2"?"2026-10-15":"2026-10-10"}, time unspecified.${revision()==="R2"?" This revision applies to applications first submitted on or after 2026-09-19; earlier submissions do not require correction.":""} All names, dates and rules are synthetic fixture data.`;
}
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||"/",`http://127.0.0.1:${port}`);const owner=session(req,res);
  try{
    if(req.method==="GET"&&url.pathname==="/health"){res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({service:"papertrail-reference-portal",status:"ok",fictional:true}));}
    if(req.method==="GET"&&url.pathname==="/")return html(res,"PaperTrail Demo Learning Centre",`<p>A separate, persistent fictional portal for browser-assisted application demonstrations.</p><article><h2>Choose a workflow</h2><p><a href="/apply/grant">Learning Support Grant</a></p><p><a href="/apply/exam">Exam registration</a></p><p><a href="/apply/renewal">Community-service renewal</a></p></article>`);
    if(req.method==="GET"&&url.pathname==="/notices")return html(res,"Demo notices",["grant","exam","renewal"].map(kind=>`<article><h2>${esc(kind)}</h2><p>${esc(noticeText(kind))}</p><a href="/apply/${kind}">Open form</a></article>`).join(""));
    if(req.method==="GET"&&/^\/apply\/(grant|exam|renewal)$/.test(url.pathname)){
      const kind=url.pathname.split("/")[2]!;
      if(kind==="renewal")return html(res,"Community-service renewal",`<p>${esc(noticeText(kind))}</p><form method="post" action="/drafts"><input name="kind" type="hidden" value="renewal"><fieldset><legend>Renewal request</legend><label>Service location<select id="renewal-location" name="location" required><option value="">Choose</option>${locations.map(value=>`<option>${esc(value)}</option>`).join("")}</select></label></fieldset><fieldset><legend>Registrant details</legend><label>Registered person name<input id="renewal-person" name="contact_name" required maxlength="200"></label><label>Registrant category<select id="renewal-type" name="category"><option value="community-member">Community member</option><option value="student">Student</option></select></label></fieldset><button type="submit">Continue to attachments</button></form>`);
      const options=kind==="exam"?`<label>Admission session<select name="session" id="portal-session"><option value="DEMO-2026-A">DEMO-2026-A</option></select></label><label>Exam centre<select name="centre" id="portal-centre"><option value="">Choose a centre</option>${centres.map(c=>`<option>${esc(c)}</option>`).join("")}</select></label><label>Course<select name="course" id="portal-course"><option value="">Choose a course</option>${courses.map(c=>`<option>${c}</option>`).join("")}</select></label>`:kind==="renewal"?`<label>Service location<select name="location" id="portal-location"><option value="">Choose a location</option>${locations.map(c=>`<option>${esc(c)}</option>`).join("")}</select></label>`:"";
      return html(res,`${kind} · step 1 of 3`,`<p>${esc(noticeText(kind))}</p><form method="post" action="/drafts"><input name="kind" type="hidden" value="${kind}"><label>Applicant name<input name="name" id="reference-name" maxlength="200" required></label><label>Applicant type<select name="applicantType" id="reference-type" required><option value="">Choose</option><option value="student">Student</option><option value="community-member">Community member</option></select></label>${options}<button type="submit">Continue to evidence</button></form>`);
    }
    if(req.method==="POST"&&url.pathname==="/drafts"){
      const form=await data(req);const fields=Object.fromEntries([...form.entries()].filter(([,v])=>typeof v==="string"));const kind=String(fields.kind);
      if(kind==="renewal"){fields.name=fields.contact_name!;fields.applicantType=fields.category!;delete fields.contact_name;delete fields.category;}
      if(!["grant","exam","renewal"].includes(kind)||!String(fields.name||"").trim()||!["student","community-member"].includes(String(fields.applicantType)))throw new Error("Complete the required applicant fields.");
      if(kind==="exam"&&(!centres.includes(String(fields.centre))||!courses.includes(String(fields.course))))throw new Error("Choose an actual exam centre and course.");
      if(kind==="renewal"&&!locations.includes(String(fields.location)))throw new Error("Choose a service location.");
      const id=randomUUID();db.prepare("insert into drafts(id,session,kind,fields,created_at) values(?,?,?,?,?)").run(id,owner,kind,JSON.stringify(fields),new Date().toISOString());return redirect(res,`/drafts/${id}/evidence`);
    }
    const step=/^\/drafts\/([0-9a-f-]{36})\/(evidence|review|submit)$/.exec(url.pathname);
    if(step){
      const draft=draftFor(step[1]!,owner);if(!draft)return html(res,"Draft unavailable","<p>Start a fresh draft in this browser.</p>",404);
      if(req.method==="GET"&&step[2]==="evidence")return html(res,"Evidence · step 2 of 3",`<form method="post" enctype="multipart/form-data"><p>Use fictional supporting documents only. Up to 20 MB total. JPEG photos: up to 200 KB.</p><label>Supporting documents<input type="file" id="portal-evidence" name="evidence" accept="application/pdf,image/jpeg,image/png,image/webp" multiple required></label><button type="submit">Review application</button></form>`);
      if(req.method==="POST"&&step[2]==="evidence"){
        const form=await data(req);const files:Record<string,unknown>[]=[];let total=0;
        for(const item of form.getAll("evidence")){if(!(item instanceof File)||!item.size)continue;total+=item.size;if(total>20*1024*1024||!["application/pdf","image/jpeg","image/png","image/webp"].includes(item.type))throw new Error("Choose supported documents within 20 MB total.");if(item.type==="image/jpeg"&&item.size>200*1024)throw new Error("JPEG photo exceeds 200 KB. Prepare a readable smaller derivative.");const bytes=Buffer.from(await item.arrayBuffer());const hash=createHash("sha256").update(bytes).digest("hex");db.prepare("insert or replace into uploads values(?,?,?,?,?)").run(draft.id,hash,item.name,item.type,bytes);files.push({name:item.name,size:item.size,mime:item.type,sha256:hash});}
        if(!files.length)throw new Error("Select at least one supporting document.");db.prepare("update drafts set files=? where id=?").run(JSON.stringify(files),draft.id);return redirect(res,`/drafts/${draft.id}/review`);
      }
      if(req.method==="GET"&&step[2]==="review")return html(res,"Review · step 3 of 3",`<article><h2>Exact applicant values</h2><pre>${esc(JSON.stringify(JSON.parse(draft.fields),null,2))}</pre><h2>Uploaded evidence</h2><pre>${esc(JSON.stringify(JSON.parse(draft.files),null,2))}</pre></article><form method="post" action="/drafts/${draft.id}/submit"><label><span><input type="checkbox" id="reference-declaration" name="declaration" required> I understand this is a fictional reference portal and am using test data only.</span></label><button id="portal-submit" type="submit">Submit fictional application</button></form>`);
      if(req.method==="POST"&&step[2]==="submit"){
        const form=await data(req);if(form.get("declaration")!=="on")throw new Error("Confirm the declaration yourself before submitting.");if(!JSON.parse(draft.files).length)throw new Error("Supporting evidence is missing.");
        const fault=String(db.prepare("select value from settings where key='fault'").get()?.value);
        if(fault==="reject_once"){db.prepare("update settings set value='none' where key='fault'").run();return html(res,"Demo rejection","<p role='alert'>The fictional portal rejected this attempt for operator-requested testing. No submission was recorded.</p>",422);}
        let record=db.prepare("select * from submissions where draft_id=?").get(draft.id);
        if(!record){const reference=`DEMO-${new Date().getUTCFullYear()}-${randomBytes(5).toString("hex").toUpperCase()}`;db.prepare("insert into submissions values(?,?,?,?,?,?,?)").run(randomUUID(),draft.id,reference,draft.kind,draft.fields,draft.files,new Date().toISOString());record=db.prepare("select * from submissions where draft_id=?").get(draft.id);}
        if(fault==="timeout_once"){
          db.prepare("update settings set value='none' where key='fault'").run();
          // Persist acceptance first, then deliberately withhold its response.
          // The browser must use the independent status page instead of reposting.
          const delayed=setTimeout(()=>{if(!res.destroyed)redirect(res,`/receipt/${record!.reference}`);},60_000);
          res.once("close",()=>clearTimeout(delayed));return;
        }
        return redirect(res,`/receipt/${record!.reference}`);
      }
    }
    const receipt=/^\/receipt\/(DEMO-[A-Z0-9-]+)$/.exec(url.pathname);
    if(req.method==="GET"&&receipt){const record=db.prepare("select * from submissions where reference=?").get(receipt[1]!);return record?html(res,"Fictional application acknowledged",`<p role="status" data-reference="${esc(record.reference)}">Fictional submission acknowledged. Reference: <strong>${esc(record.reference)}</strong></p><p>Recorded ${esc(record.created_at)}. This is an acknowledgement from the demonstration portal, not institutional acceptance.</p><details><summary>Recorded fields and evidence hashes</summary><pre id="receipt-payload">${esc(JSON.stringify({fields:JSON.parse(String(record.fields)),files:JSON.parse(String(record.files))},null,2))}</pre></details><p><a href="/status?reference=${esc(record.reference)}">Verify status</a></p>`):html(res,"No receipt","<p>No matching fictional submission exists.</p>",404);}
    if(req.method==="GET"&&url.pathname==="/status"){
      const ref=url.searchParams.get("reference");const draftId=url.searchParams.get("draft");const record=ref?db.prepare("select * from submissions where reference=?").get(ref):draftId?db.prepare("select s.* from submissions s join drafts d on d.id=s.draft_id where d.id=? and d.session=?").get(draftId,owner):null;
      if(record)return redirect(res,`/receipt/${record.reference}`);
      return html(res,"Check fictional receipt",`<form method="get"><label>Reference<input name="reference" required></label><button type="submit">Check status</button></form>${ref||draftId?"<p>No matching acknowledgement was found. Do not assume submission succeeded.</p>":""}`);
    }
    if(req.method==="POST"&&url.pathname==="/operator"){
      const expected=process.env.DEMO_OPERATOR_SECRET;const actual=req.headers["x-demo-operator-secret"];
      if(process.env.DEMO_MODE!=="true"||!expected||typeof actual!=="string"||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return html(res,"Operator unavailable","",403);
      const form=await data(req);const nextRevision=form.get("revision");const fault=form.get("fault");
      if(nextRevision&&["R1","R2"].includes(String(nextRevision)))db.prepare("update settings set value=? where key='revision'").run(String(nextRevision));
      if(fault&&["none","timeout_once","reject_once"].includes(String(fault)))db.prepare("update settings set value=? where key='fault'").run(String(fault));
      res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({revision:revision(),submissions:db.prepare("select count(*) as n from submissions").get()?.n}));
    }
    return html(res,"Page unavailable","<p><a href='/'>Return to demo portal</a></p>",404);
  }catch(error){return html(res,"Please review your application",`<p class="error" role="alert">${esc(error instanceof Error?error.message:"The request failed.")}</p><p>Use your browser Back button to correct the form.</p>`,400);}
});
server.listen(port,process.env.REFERENCE_PORTAL_HOST||"127.0.0.1",()=>console.log(JSON.stringify({service:"papertrail-reference-portal",port,fictional:true})));
process.once("SIGTERM",()=>server.close(()=>db.close()));
process.once("SIGINT",()=>server.close(()=>db.close()));
