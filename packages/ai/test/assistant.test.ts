import {describe,it,expect,vi} from "vitest";
import {generateAssistantReply} from "../src/assistant.js";
import {validateRecordedAudio} from "../src/audio.js";

describe("owner-selected assistant",()=>{
  it("uses Gemini without putting its key into the request URL and returns a proposed correction",async()=>{
    const transport=vi.fn(async(url,init)=>{
      expect(String(url)).not.toContain("fictional-owner-key");
      expect(init.headers["x-goog-api-key"]).toBe("fictional-owner-key");
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({reply:"Please confirm the new spelling.",correction:{factKey:"applicant_name",value:"Demo Applicant"}})}]}}]}));
    });
    const result=await generateAssistantReply({provider:"gemini",model:"gemini-2.5-flash",apiKey:"fictional-owner-key"},{application:{title:"Demo"}},"Correct my name to Demo Applicant",transport as typeof fetch);
    expect(result.correction?.value).toBe("Demo Applicant");
  });
  it("does not retry a rejected paid request",async()=>{
    const transport=vi.fn(async()=>new Response("",{status:401}));
    await expect(generateAssistantReply({provider:"openai",model:"test-model",apiKey:"fictional-key"},{},"Help",transport)).rejects.toThrow("AI_PROVIDER_HTTP_401");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("drops invalid fact-correction arguments rather than treating model output as state",async()=>{
    const transport=async()=>new Response(JSON.stringify({output:[{content:[{type:"output_text",text:JSON.stringify({reply:"Review this.",correction:{factKey:"owner_id; arbitrary code",value:"another owner"}})}]}]}));
    const result=await generateAssistantReply({provider:"openai",model:"test-model",apiKey:"fictional-key"},{},"Help",transport);
    expect(result).toEqual({reply:"Review this."});
  });
});

function wav(seconds:number){
  const sampleRate=8000;const size=seconds*sampleRate*2;const bytes=new Uint8Array(44+size);const view=new DataView(bytes.buffer);
  const text=(offset:number,value:string)=>[...value].forEach((character,index)=>view.setUint8(offset+index,character.charCodeAt(0)));
  text(0,"RIFF");view.setUint32(4,36+size,true);text(8,"WAVEfmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,"data");view.setUint32(40,size,true);return bytes;
}
describe("recorded-audio admission",()=>{
  it("measures duration from audio bytes before any provider call",async()=>{await expect(validateRecordedAudio(wav(1),"audio/wav")).resolves.toBe(1);await expect(validateRecordedAudio(wav(301),"audio/wav")).rejects.toThrow("AUDIO_DURATION_INVALID");});
});
