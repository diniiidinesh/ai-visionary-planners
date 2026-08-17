import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface DocRow {
  source_id: string;
  title: string;
  chunk_count: number;
  embedding_model: string | null;
  chunk_size: number | null;
  chunk_overlap: number | null;
}

interface ChunkRow {
  id: string;
  chunk_index: number;
  content: string;
  char_count: number | null;
  heading: string | null;
  embedding_model: string;
}

/** Longest suffix of `a` that is also a prefix of `b` (the real overlap window). */
function overlapLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length, 400);
  for (let len = max; len > 20; len--) {
    if (a.slice(a.length - len) === b.slice(0, len)) return len;
  }
  return 0;
}

function parseVector(raw: unknown): number[] | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as number[];
  } catch {
    return null;
  }
}

export const ChunkInspector = () => {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [vectorFor, setVectorFor] = useState<string | null>(null);
  const [vectors, setVectors] = useState<{ openai: number[] | null; voyage: number[] | null } | null>(null);
  const [vectorLoading, setVectorLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("document_index")
        .select("source_id, title, chunk_count, embedding_model, chunk_size, chunk_overlap")
        .eq("ingest_status", "indexed")
        .order("chunk_count", { ascending: false })
        .limit(50);
      const rows = (data ?? []) as DocRow[];
      setDocs(rows);
      if (rows.length > 0) setSelected(rows[0].source_id);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    setVectorFor(null);
    setVectors(null);
    (async () => {
      const { data } = await supabase
        .from("document_chunks")
        .select("id, chunk_index, content, char_count, heading, embedding_model")
        .eq("source_id", selected)
        .order("chunk_index", { ascending: true })
        .limit(60);
      setChunks((data ?? []) as ChunkRow[]);
    })();
  }, [selected]);

  const loadVector = async (chunkId: string) => {
    setVectorFor(chunkId);
    setVectorLoading(true);
    const { data } = await supabase
      .from("document_chunks")
      .select("embedding, embedding_voyage")
      .eq("id", chunkId)
      .maybeSingle();
    setVectors({
      openai: parseVector((data as Record<string, unknown> | null)?.embedding),
      voyage: parseVector((data as Record<string, unknown> | null)?.embedding_voyage),
    });
    setVectorLoading(false);
  };

  const doc = docs.find((d) => d.source_id === selected);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your index…
        </CardContent>
      </Card>
    );
  }

  if (docs.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Nothing indexed yet — run an index from the Connect page and this inspector will fill with your
          own documents.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Live chunk inspector</CardTitle>
        <CardDescription>
          Your real stored chunks. Notice how consecutive chunks repeat their boundary text — that is the
          overlap, highlighted below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {docs.map((d) => (
              <SelectItem key={d.source_id} value={d.source_id}>
                {d.title} · {d.chunk_count} chunks
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {doc && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">chunk_size {doc.chunk_size ?? "—"}</Badge>
            <Badge variant="secondary">overlap {doc.chunk_overlap ?? "—"}</Badge>
            <Badge variant="secondary">{doc.embedding_model ?? "—"}</Badge>
          </div>
        )}

        <div className="space-y-3">
          {chunks.map((chunk, i) => {
            const prev = chunks[i - 1];
            const overlap = prev ? overlapLength(prev.content, chunk.content) : 0;
            return (
              <div key={chunk.id} className="rounded-md border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">chunk {chunk.chunk_index}</Badge>
                  <span>{chunk.char_count ?? chunk.content.length} chars</span>
                  {chunk.heading && <span className="truncate">§ {chunk.heading}</span>}
                  {overlap > 0 && <span className="text-accent">carries {overlap} chars of overlap</span>}
                </div>
                <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                  {overlap > 0 && (
                    <span className="rounded bg-accent/15 text-accent-foreground/90">
                      {chunk.content.slice(0, overlap)}
                    </span>
                  )}
                  {chunk.content.slice(overlap, overlap + 700)}
                  {chunk.content.length > overlap + 700 && "…"}
                </p>
                <div className="mt-2">
                  {vectorFor === chunk.id ? (
                    vectorLoading ? (
                      <span className="text-xs text-muted-foreground">Loading vector…</span>
                    ) : (
                      <div className="space-y-2 text-xs">
                        <div>
                          <span className="font-medium">OpenAI </span>
                          <span className="text-muted-foreground">
                            {vectors?.openai ? `${vectors.openai.length} dims` : "not stored"}
                          </span>
                          {vectors?.openai && (
                            <p className="mt-1 break-all font-mono text-muted-foreground">
                              [{vectors.openai.slice(0, 8).map((n) => n.toFixed(4)).join(", ")}, … ]
                            </p>
                          )}
                        </div>
                        <div>
                          <span className="font-medium">Voyage </span>
                          <span className="text-muted-foreground">
                            {vectors?.voyage ? `${vectors.voyage.length} dims` : "not stored — run a full re-index"}
                          </span>
                          {vectors?.voyage && (
                            <p className="mt-1 break-all font-mono text-muted-foreground">
                              [{vectors.voyage.slice(0, 8).map((n) => n.toFixed(4)).join(", ")}, … ]
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  ) : (
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => loadVector(chunk.id)}>
                      Show this chunk as numbers
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};