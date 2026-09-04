import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface HealthRow {
  ingest_status: string;
  documents: number;
  chunks: number;
  oldest_update: string | null;
  newest_update: string | null;
}

// Presentation only: how each backend status should read to a human, and what
// colour the bar segment gets. Anything unknown falls through to a neutral
// style rather than being hidden, so a new status can never silently vanish
// from the totals.
const STATUS_META: Record<string, { label: string; note: string; bar: string; dot: string }> = {
  indexed: {
    label: "Indexed",
    note: "Chunked, embedded and searchable",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
  },
  pending: {
    label: "Queued",
    note: "Discovered, waiting to be processed",
    bar: "bg-amber-400",
    dot: "bg-amber-400",
  },
  processing: {
    label: "In flight",
    note: "Being processed right now — if indexing is stopped, these are stale",
    bar: "bg-sky-500",
    dot: "bg-sky-500",
  },
  failed: {
    label: "Failed",
    note: "Errored during processing; will retry on the next run",
    bar: "bg-destructive",
    dot: "bg-destructive",
  },
  skipped_no_text: {
    label: "Skipped — no text",
    note: "Images, videos or empty files with nothing to embed",
    bar: "bg-muted-foreground/50",
    dot: "bg-muted-foreground/50",
  },
  skipped_too_large: {
    label: "Skipped — too large",
    note: "Over the per-file size ceiling that protects the ingest run",
    bar: "bg-muted-foreground/50",
    dot: "bg-muted-foreground/50",
  },
  skipped_unsupported: {
    label: "Skipped — unsupported type",
    note: "File format the parser cannot read",
    bar: "bg-muted-foreground/50",
    dot: "bg-muted-foreground/50",
  },
};

function metaFor(status: string) {
  return (
    STATUS_META[status] ?? {
      label: status,
      note: "Unrecognised status",
      bar: "bg-muted-foreground/40",
      dot: "bg-muted-foreground/40",
    }
  );
}

function relative(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const IndexHealthPanel = () => {
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("index_health");
    if (rpcError) {
      setError(rpcError.message);
      setRows([]);
    } else {
      setRows((data ?? []) as HealthRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalDocs = rows.reduce((sum, r) => sum + Number(r.documents), 0);
  const totalChunks = rows.reduce((sum, r) => sum + Number(r.chunks), 0);
  const indexed = rows.find((r) => r.ingest_status === "indexed");
  const pct = totalDocs > 0 ? (Number(indexed?.documents ?? 0) / totalDocs) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" /> Index health
            </CardTitle>
            <CardDescription>
              Every file discovered in your Drive, grouped by how far it got through the pipeline. This is the
              catalog's own bookkeeping — the passages browser below shows the chunks those documents produced.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {!error && loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {!error && !loading && totalDocs === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing discovered yet. Connect Drive and run an index to populate this.
          </p>
        )}

        {totalDocs > 0 && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <div>
                <p className="text-2xl font-semibold tabular-nums">{pct.toFixed(1)}%</p>
                <p className="text-xs text-muted-foreground">of the catalog is searchable</p>
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="font-mono text-foreground">{totalDocs.toLocaleString()}</span> documents ·{" "}
                <span className="font-mono text-foreground">{totalChunks.toLocaleString()}</span> passages
              </div>
            </div>

            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
              {rows.map((r) => (
                <div
                  key={r.ingest_status}
                  className={metaFor(r.ingest_status).bar}
                  style={{ width: `${(Number(r.documents) / totalDocs) * 100}%` }}
                  title={`${metaFor(r.ingest_status).label}: ${Number(r.documents).toLocaleString()}`}
                />
              ))}
            </div>

            <div className="divide-y rounded-lg border">
              {rows.map((r) => {
                const meta = metaFor(r.ingest_status);
                const docs = Number(r.documents);
                return (
                  <div key={r.ingest_status} className="flex items-start justify-between gap-4 p-3">
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                      <div>
                        <p className="text-sm font-medium">{meta.label}</p>
                        <p className="text-xs text-muted-foreground">{meta.note}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{r.ingest_status}</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-sm tabular-nums">{docs.toLocaleString()}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {((docs / totalDocs) * 100).toFixed(1)}%
                        {Number(r.chunks) > 0 && ` · ${Number(r.chunks).toLocaleString()} passages`}
                      </p>
                      <p className="text-[11px] text-muted-foreground">last change {relative(r.newest_update)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              Queued files are picked up one at a time by the ingest run — the count only falls while indexing
              is actually running. Documents stuck in "In flight" long after a run has stopped were interrupted
              mid-file and are re-queued on the next full re-index.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default IndexHealthPanel;
