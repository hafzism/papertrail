import type {ClaimedJob,WorkerRepository} from "@papertrail/db";
import type {JobHandler} from "./durable-worker.js";
import {decryptApiKey,resolveAiCredentialEncryptionSecret} from "./ai-credential-vault.js";

export class CloseVoiceSessionHandler implements JobHandler {
  readonly supportedKinds=["close_voice_session"] as const;
  constructor(private readonly repository:WorkerRepository){}
  async handle(job:ClaimedJob){
    const call=await this.repository.beginVoiceProviderClose(job);
    if(!call)return {state:"succeeded" as const};
    const key=decryptApiKey(call.key_ciphertext,resolveAiCredentialEncryptionSecret());
    const response=await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(call.provider_call_id)}/hangup`,{method:"POST",headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10_000)});
    if(!response.ok&&![404,410].includes(response.status))return {state:"failed" as const,errorCode:`VOICE_HANGUP_HTTP_${response.status}`};
    return await this.repository.finishVoiceProviderClose(job)?{state:"succeeded" as const}:{state:"outcome_unknown" as const,errorCode:"VOICE_CLOSE_FENCE_REJECTED"};
  }
}
