import {randomUUID,createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {loadGatewayConfig} from "./config.js";
import {BrowserSessionManager} from "./session-manager.js";

const portal="http://127.0.0.1:3001";
const manager=new BrowserSessionManager(loadGatewayConfig({BROWSER_HEADLESS:"true",BROWSER_GATEWAY_SECRET:"fictional-local-smoke-secret-only",BROWSER_ALLOWED_ORIGINS:portal}));
let active:string|null=null;
try{
  const bytes=await readFile(resolve(import.meta.dirname,"../../../tests/fixtures/showcase/ordinary-english-acroform.pdf"));
  const action={actionId:"reference-demo-submit",kind:"reference_portal_acknowledgement" as const,applicantName:"Fictional Browser Applicant",applicantType:"student" as const,declarationAccepted:true as const,payloadSha256:"0".repeat(64),portalFields:{name:"Fictional Browser Applicant",applicantType:"student",kind:"grant"},attachments:[{filename:"fictional-form.pdf",mimeType:"application/pdf",sha256:createHash("sha256").update(bytes).digest("hex"),bytesBase64:bytes.toString("base64")}]};
  const session=await manager.create({ownerId:randomUUID(),applicationId:randomUUID(),runId:randomUUID(),destination:portal+"/apply/grant",approvedDemoAction:action});
  active=session.id;
  const result=await manager.executeApprovedDemoAction(session.id,action.actionId);
  console.log(JSON.stringify({passed:!!result.reference,reference:result.reference}));
}catch(error){console.error(error);if(active)console.error(await manager.get(active)?.page.locator("#receipt-payload").textContent({timeout:1000}).catch(()=>"No fictional receipt payload."));process.exitCode=1;}
finally{await manager.shutdown();}
