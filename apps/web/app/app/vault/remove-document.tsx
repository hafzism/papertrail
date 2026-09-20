"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../src/lib/supabase/client";

interface RemovalPaths {
  document_object_paths: string[];
  artifact_object_paths: string[];
}

export function RemoveDocument({ documentId, label }: { documentId: string; label: string }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [cleanup, setCleanup] = useState<RemovalPaths | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function removeStorage(paths: RemovalPaths): Promise<boolean> {
    const supabase = createClient();
    const [documentResult, artifactResult] = await Promise.all([
      paths.document_object_paths.length > 0 ? supabase.storage.from("private-documents").remove(paths.document_object_paths) : Promise.resolve({ error: null }),
      paths.artifact_object_paths.length > 0 ? supabase.storage.from("private-artifacts").remove(paths.artifact_object_paths) : Promise.resolve({ error: null }),
    ]);
    return documentResult.error === null && artifactResult.error === null;
  }

  async function cleanUp(paths: RemovalPaths): Promise<void> {
    setRemoving(true);
    setError(null);
    const removed = await removeStorage(paths);
    setRemoving(false);
    if (!removed) {
      setCleanup(paths);
      setError("The document is hidden, but private file cleanup could not finish. Keep this page open and retry cleanup.");
      return;
    }
    router.refresh();
  }

  async function requestRemoval(): Promise<void> {
    if (!window.confirm(`Remove “${label}” from your private vault? Its evidence links will need review. This cannot be undone from the current workspace.`)) return;
    setRemoving(true);
    setError(null);
    const { data, error: rpcError } = await createClient().rpc("remove_private_document", { p_document_id: documentId });
    const paths = Array.isArray(data) ? data[0] as RemovalPaths | undefined : undefined;
    if (rpcError || paths === undefined) {
      setRemoving(false);
      setError("The document could not be removed. Refresh and try again.");
      return;
    }
    await cleanUp(paths);
  }

  return <div className="mt-4">
    {cleanup ? <button className="min-h-11 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 disabled:cursor-not-allowed disabled:opacity-60" disabled={removing} onClick={() => cleanUp(cleanup)} type="button">{removing ? "Cleaning up…" : "Retry private file cleanup"}</button> : <button className="min-h-11 rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={removing} onClick={requestRemoval} type="button">{removing ? "Removing…" : "Remove document"}</button>}
    {error ? <p className="mt-2 rounded-md bg-amber-50 p-3 text-sm leading-6 text-amber-900" role="alert">{error}</p> : null}
  </div>;
}
