import { parseBuffer } from "music-metadata";

export async function validateRecordedAudio(bytes: Uint8Array, mimeType: string): Promise<number> {
  if (bytes.byteLength<1 || bytes.byteLength>20*1024*1024) throw new Error("AUDIO_SIZE_INVALID");
  const metadata = await parseBuffer(bytes, { mimeType }, { duration: true, skipCovers: true });
  const duration = metadata.format.duration;
  if (!duration || !Number.isFinite(duration) || duration>300) throw new Error("AUDIO_DURATION_INVALID");
  return duration;
}
