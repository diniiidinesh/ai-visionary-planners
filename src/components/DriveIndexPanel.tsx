import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Database, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// Must match the ingestion settings in supabase/functions/_shared/rag/chunker.ts
const CURRENT_EMBEDDING_MODEL = "openai/text-embedding-3-large";
const CURRENT_CHUNK_SIZE = 1200;
const CURRENT_CHUNK_OVERLAP = 200;
const CURRENT_METADATA_VERSION = 2;
const AUTO_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface IndexStats {
  documents: number;
  chunks: number;
  lastSynced: string | null;
  staleDocuments: number;
}

interface BatchProgress {
  files: number;
  chunks: number;
  skipped: number;
  failed: number;
}

const DriveIndexPanel = ({ connected }: { connected: boolean }) => {
  const { toast } = useToast();
  const [stats, setStats] = useState<IndexStats>({ documents: 0, chunks: 0, lastSynced: null, staleDocuments: 0 });
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState<BatchProgress>({ files: 0, chunks: 0, skipped: 0, failed: 0 });
  const [autoSync, setAutoSync] = useState(false);

  const loadStats = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: docs }, { count: chunkCount }, { data: staleRows }] = await Promise.all([
      supabase
        .from("document_index")
        .select("last_synced, chunk_count")
        .eq("user_id", user.id)
        .eq("source_type", "google_drive")
        .gt("chunk_count", 0),
      supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase
        .from("document_chunks")
        .select("source_id")
        .eq("user_id", user.id)
        .or(
          `embedding_model.neq.${CURRENT_EMBEDDING_MODEL},chunk_size.neq.${CURRENT_CHUNK_SIZE},chunk_overlap.neq.${CURRENT_CHUNK_OVERLAP},metadata_version.neq.${CURRENT_METADATA_VERSION}`,
        ),
    ]);

    const lastSynced = (docs ?? [])
      .map((d) => d.last_synced)
      .filter(Boolean)
      .sort()
      .pop() ?? null;

    const staleDocuments = new Set((staleRows ?? []).map((r: { source_id: string }) => r.source_id)).size;
    setStats({ documents: docs?.length ?? 0, chunks: chunkCount ?? 0, lastSynced, staleDocuments });
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Load the saved auto-sync preference.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("user_ai_preferences")
        .select("auto_sync_daily")
        .eq("user_id", user.id)
        .maybeSingle();
      setAutoSync(data?.auto_sync_daily ?? false);
    })();
  }, []);

  const runIndex = async (fullResync: boolean) => {
    setIndexing(true);
    setProgress({ files: 0, chunks: 0, skipped: 0, failed: 0 });

    let pageToken: string | undefined = undefined;
    let totals: BatchProgress = { files: 0, chunks: 0, skipped: 0, failed: 0 };

    try {
      // Batches are resumable: keep calling until the function reports done.
      for (let batch = 0; batch < 200; batch++) {
        const { data, error } = await supabase.functions.invoke("ingest-drive-documents", {
          body: { pageToken, fullResync },
        });

        if (error) {
          const details = (data as any)?.error ?? error.message;
          throw new Error(details);
        }

        totals = {
          files: totals.files + (data.processed ?? 0),
          chunks: totals.chunks + (data.chunksStored ?? 0),
          skipped: totals.skipped + (data.skipped ?? 0),
          failed: totals.failed + (data.failed ?? 0),
        };
        setProgress(totals);

        if (data.done) break;
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }

      toast({
        title: "Indexing complete",
        description: `${totals.files} documents indexed, ${totals.chunks} passages stored.`,
      });
    } catch (e) {
      console.error("Indexing failed:", e);
      toast({
        title: "Indexing stopped",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIndexing(false);
      loadStats();
    }
  };

  // Daily auto-sync: runs at most once per day when the page is opened.
  useEffect(() => {
    if (!autoSync || !connected || indexing) return;
    const due =
      !stats.lastSynced || Date.now() - new Date(stats.lastSynced).getTime() > AUTO_SYNC_INTERVAL_MS;
    if (due) runIndex(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync, connected, stats.lastSynced]);

  const toggleAutoSync = async (enabled: boolean) => {
    setAutoSync(enabled);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("user_ai_preferences")
      .upsert({ user_id: user.id, auto_sync_daily: enabled }, { onConflict: "user_id" });
    if (error) {
      setAutoSync(!enabled);
      toast({ title: "Could not save setting", description: error.message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Database className="w-5 h-5" />
          Document index
        </CardTitle>
        <CardDescription>
          Indexing reads your Drive documents once, splits them into passages and stores them for
          semantic search, so answers can quote the exact passage instead of only the first page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-semibold">{stats.documents}</p>
            <p className="text-xs text-muted-foreground">documents</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">{stats.chunks}</p>
            <p className="text-xs text-muted-foreground">passages</p>
          </div>
          <div>
            <p className="text-sm font-medium pt-2">
              {stats.lastSynced ? new Date(stats.lastSynced).toLocaleString() : "Never"}
            </p>
            <p className="text-xs text-muted-foreground">last synced</p>
          </div>
        </div>

        {stats.staleDocuments > 0 && !indexing && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium">{stats.staleDocuments} document(s) indexed with older settings</p>
              <p className="text-muted-foreground">
                Chunk size, overlap, embedding model or metadata changed since these were indexed. Run a
                full re-index so every passage is comparable.
              </p>
            </div>
          </div>
        )}

        {indexing && (
          <div className="space-y-2">
            <Progress value={undefined} className="h-2" />
            <p className="text-sm text-muted-foreground">
              {progress.files} indexed · {progress.chunks} passages · {progress.skipped} unchanged
              {progress.failed > 0 ? ` · ${progress.failed} failed` : ""}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => runIndex(false)} disabled={!connected || indexing}>
            {indexing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
            {stats.chunks > 0 ? "Sync new changes" : "Index my Drive"}
          </Button>
          <Button variant="outline" onClick={() => runIndex(true)} disabled={!connected || indexing}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Full re-index
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="auto-sync">Auto-sync daily</Label>
            <p className="text-xs text-muted-foreground">
              Checks for new and edited Drive files once a day when you open the app.
            </p>
          </div>
          <Switch id="auto-sync" checked={autoSync} onCheckedChange={toggleAutoSync} disabled={!connected} />
        </div>

        {!connected && (
          <p className="text-sm text-muted-foreground">Connect Google Drive above to start indexing.</p>
        )}
      </CardContent>
    </Card>
  );
};

export default DriveIndexPanel;
