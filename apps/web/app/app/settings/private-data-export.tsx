"use client";

interface ExportOverview { exportedAt: string; profile: unknown; applications: unknown; documents: unknown; activities: unknown; notifications: unknown; }

export function PrivateDataExport({ overview }: { overview: ExportOverview }) {
  function download(): void {
    const blob = new Blob([JSON.stringify(overview, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = "papertrail-private-data-overview.json"; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="mt-5 rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm"><h3 className="font-bold">Download private data overview</h3><p className="mt-2 text-sm leading-6 text-[var(--slate)]">Exports your currently visible profile, application, document, activity, and notification metadata as JSON. It does not download original private document bytes or create a public link.</p><button className="mt-4 min-h-11 cursor-pointer rounded-lg border border-[var(--border)] bg-white px-4 py-2 font-semibold text-[var(--navy)] transition-colors duration-200 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)]" onClick={download} type="button">Download JSON overview</button></div>;
}
