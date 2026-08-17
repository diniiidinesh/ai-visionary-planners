import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Database, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface IndexStats {
  documents: number;
  chunks: number;
  lastSynced: string | null;
}

interface BatchProgress {
  files: number;
  chunks: number;
  skipped: number;
  failed: number;
}

const DriveIndexPanel = ({ connected }: { connected: boolean }) => {
  const { toast } = useToast();
  const [stats, setStats] = useState<IndexStats>({ documents: 0, chunks: 0, lastSynced: null });
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState<BatchProgress>({ files: 0, chunks: 0, skipped: 0, failed: 0 });

  const loadStats = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: docs }, { count: chunkCount }] = await Promise.all([
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
    ]);

    const lastSynced = (docs ?? [])
      .map((d) => d.last_synced)
      .filter(Boolean)
      .sort()
      .pop() ?? null;

    setStats({ documents: docs?.length ?? 0, chunks: chunkCount ?? 0, lastSynced });
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

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

        {!connected && (
          <p className="text-sm text-muted-foreground">Connect Google Drive above to start indexing.</p>
        )}
      </CardContent>
    </Card>
  );
};

export default DriveIndexPanel;
