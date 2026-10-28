import {describe,it,expect} from "vitest";
import {boundedFileBytes,sniffTelegramDocument} from "../src/process-telegram-intake.js";

describe("Telegram private-file admission",()=>{
  it("uses actual file signatures and rejects arbitrary executable content",()=>{
    expect(sniffTelegramDocument(new TextEncoder().encode("%PDF-1.7 fictional"))).toEqual({mimeType:"application/pdf",extension:"pdf"});
    expect(()=>sniffTelegramDocument(new TextEncoder().encode("<script>untrusted</script>"))).toThrow("Choose a PDF");
  });
  it("caps actual streamed bytes even when content length is absent",async()=>{
    const response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(9));controller.enqueue(new Uint8Array(9));controller.close();}}));
    await expect(boundedFileBytes(response,10)).rejects.toThrow("exceeds 20 MB");
  });
});
