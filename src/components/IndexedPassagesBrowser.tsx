import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Loader2, RefreshCw, Search as SearchIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface IndexedDoc {
  source_id: string;
  title: string;
  full_url: string | null;
  chunk_count: number | null;
  ingest_status: string | null;
  ingest_error: string | null;
  last_synced: string | null;
  metadata: any;
}

interface Chunk {
  id: string;
  chunk_index: number;
  content: string;
  char_count: number | null;
  embedding_model: string | null;
  embedding_voyage_model: string | null;
}

interface Coverage {
  source_id: string;
  total_chunks: number;
  openai_chunks: number;
  voyage_chunks: number;
  openai_model: string | null;
  voyage_model: string | null;
}

const FRIENDLY_TYPE: Record<string, string> = {
  "application/pdf": "PDF",
  "text/plain": "Text",
  "text/markdown": "Markdown",
  "text/csv": "CSV",
  "application/vnd.google-apps.document": "Google Doc",
  "application/vnd.google-apps.spreadsheet": "Google Sheet",
  "application/vnd.google-apps.presentation": "Google Slides",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
  "application/msword": "Word (legacy)",
  "application/vnd.ms-excel": "Excel (legacy)",
  "application/vnd.ms-powerpoint": "PowerPoint (legacy)",
};

const STATUS_LABEL: Record<string, string> = {
  indexed: "Indexed",
  failed: "Failed",
  skipped_no_text: "No readable text",
  skipped_too_large: "Too large",
  skipped_unsupported: "Unsupported format",
};

const IndexedPassagesBrowser = () => {
  const [docs, setDocs] = useState<IndexedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDoc, setOpenDoc] = useState<string>("");
  const [chunks, setChunks] = useState<Record<string, Chunk[]>>({});
  const [loadingChunks, setLoadingChunks] = useState(false);
  const [filter, setFilter] = useState("");
  const [coverage, setCoverage] = useState<Record<string, Coverage>>({});
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [embeddingFilter, setEmbeddingFilter] = useState<string>("all");

  const loadDocs = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("document_index")
      .select("source_id, title, full_url, chunk_count, ingest_status, ingest_error, last_synced, metadata")
      .eq("user_id", user.id)
      .eq("source_type", "google_drive")
      .order("last_synced", { ascending: false });
    setDocs((data ?? []) as IndexedDoc[]);
    const { data: cov } = await (supabase as any).rpc("embedding_coverage_by_document");
    const map: Record<string, Coverage> = {};
    for (const row of (cov ?? []) as Coverage[]) map[row.source_id] = row;
    setCoverage(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  const loadChunks = useCallback(async (sourceId: string) => {
    if (chunks[sourceId]) return;
    setLoadingChunks(true);
    const { data } = await supabase
      .from("document_chunks")
      .select("id, chunk_index, content, char_count, embedding_model, embedding_voyage_model")
      .eq("source_id", sourceId)
      .order("chunk_index", { ascending: true });
    setChunks((prev) => ({ ...prev, [sourceId]: (data ?? []) as Chunk[] }));
    setLoadingChunks(false);
  }, [chunks]);

  const handleOpen = (value: string) => {
    setOpenDoc(value);
    if (value) loadChunks(value);
  };

  const needle = filter.trim().toLowerCase();

  const visibleDocs = useMemo(() => {
    return docs.filter((d) => {
      const status = d.ingest_status ?? "unknown";
      if (statusFilter !== "all") {
        if (statusFilter === "skipped") {
          if (!status.startsWith("skipped")) return false;
        } else if (statusFilter === "pending") {
          if (status !== "pending" && status !== "unknown") return false;
        } else if (status !== statusFilter) return false;
      }

      if (embeddingFilter !== "all") {
        const cov = coverage[d.source_id];
        const openai = cov?.openai_chunks ?? 0;
        const voyage = cov?.voyage_chunks ?? 0;
        const total = cov?.total_chunks ?? 0;
        if (embeddingFilter === "both" && !(openai > 0 && voyage > 0)) return false;
        if (embeddingFilter === "openai_only" && !(openai > 0 && voyage === 0)) return false;
        if (embeddingFilter === "voyage_only" && !(voyage > 0 && openai === 0)) return false;
        if (embeddingFilter === "none" && total > 0 && (openai > 0 || voyage > 0)) return false;
        if (embeddingFilter === "partial" && !(total > 0 && (openai < total || voyage < total))) return false;
      }

      if (needle) {
        if (d.title?.toLowerCase().includes(needle)) return true;
        const loaded = chunks[d.source_id];
        return Boolean(loaded?.some((c) => c.content.toLowerCase().includes(needle)));
      }
      return true;
    });
  }, [docs, chunks, needle, coverage, statusFilter, embeddingFilter]);

  const highlight = (text: string) => {
    if (!needle) return text;
    const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
    return parts.map((part, i) =>
      part.toLowerCase() === needle
        ? <mark key={i} className="bg-primary/20 text-foreground rounded px-0.5">{part}</mark>
        : <span key={i}>{part}</span>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="w-5 h-5" />
              Indexed passages
            </CardTitle>
            <CardDescription>
              Every document the index knows about, and the exact passages stored for it. Files that were
              skipped or failed show the reason, so you can tell why a document never appears in answers.
              Each document is also tagged with the embedding space(s) its passages live in — OpenAI,
              Voyage, or both.
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={loadDocs} aria-label="Refresh">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Filter by document name, or by words inside opened passages"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger aria-label="Filter by chunking status">
              <SelectValue placeholder="Chunking status" />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              <SelectItem value="all">All chunking statuses</SelectItem>
              <SelectItem value="indexed">Indexed</SelectItem>
              <SelectItem value="pending">Pending / queued</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="skipped">Skipped (any reason)</SelectItem>
              <SelectItem value="skipped_no_text">Skipped — no readable text</SelectItem>
              <SelectItem value="skipped_too_large">Skipped — too large</SelectItem>
              <SelectItem value="skipped_unsupported">Skipped — unsupported format</SelectItem>
            </SelectContent>
          </Select>

          <Select value={embeddingFilter} onValueChange={setEmbeddingFilter}>
            <SelectTrigger aria-label="Filter by embedding space">
              <SelectValue placeholder="Embedding space" />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              <SelectItem value="all">All embedding spaces</SelectItem>
              <SelectItem value="both">Both OpenAI and Voyage</SelectItem>
              <SelectItem value="openai_only">OpenAI only</SelectItem>
              <SelectItem value="voyage_only">Voyage only</SelectItem>
              <SelectItem value="partial">Partially embedded</SelectItem>
              <SelectItem value="none">No embeddings</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!loading && (
          <p className="text-xs text-muted-foreground">
            Showing {visibleDocs.length} of {docs.length} documents
          </p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading documents…
          </div>
        ) : visibleDocs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {docs.length === 0
              ? "Nothing indexed yet. Run “Index my Drive” above."
              : "No documents match the current filters."}
          </p>
        ) : (
          <Accordion type="single" collapsible value={openDoc} onValueChange={handleOpen}>
            {visibleDocs.map((doc) => {
              const status = doc.ingest_status ?? "unknown";
              const mime = doc.metadata?.mimeType as string | undefined;
              const docChunks = chunks[doc.source_id];
              const cov = coverage[doc.source_id];
              const hasOpenai = (cov?.openai_chunks ?? 0) > 0;
              const hasVoyage = (cov?.voyage_chunks ?? 0) > 0;
              const partialOpenai = hasOpenai && cov && cov.openai_chunks < cov.total_chunks;
              const partialVoyage = hasVoyage && cov && cov.voyage_chunks < cov.total_chunks;
              return (
                <AccordionItem key={doc.source_id} value={doc.source_id}>
                  <AccordionTrigger className="text-left">
                    <div className="flex flex-1 flex-wrap items-center gap-2 pr-3">
                      <span className="font-medium">{doc.title}</span>
                      {mime && <Badge variant="secondary">{FRIENDLY_TYPE[mime] ?? mime}</Badge>}
                      <Badge variant={status === "indexed" ? "default" : "outline"}>
                        {STATUS_LABEL[status] ?? status}
                      </Badge>
                      {hasOpenai && (
                        <Badge variant="outline" className="border-primary/50 text-primary">
                          OpenAI{partialOpenai ? ` ${cov!.openai_chunks}/${cov!.total_chunks}` : ""}
                        </Badge>
                      )}
                      {hasVoyage && (
                        <Badge variant="outline" className="border-accent-foreground/40">
                          Voyage{partialVoyage ? ` ${cov!.voyage_chunks}/${cov!.total_chunks}` : ""}
                        </Badge>
                      )}
                      {cov && !hasOpenai && !hasVoyage && (
                        <Badge variant="outline" className="text-muted-foreground">No embeddings</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {doc.chunk_count ?? 0} passages
                        {doc.last_synced ? ` · ${new Date(doc.last_synced).toLocaleString()}` : ""}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    {doc.ingest_error && (
                      <p className="mb-3 text-sm text-destructive">{doc.ingest_error}</p>
                    )}
                    {cov && (
                      <p className="mb-3 text-xs text-muted-foreground">
                        Embedded in{" "}
                        {hasOpenai && hasVoyage ? "both spaces" : hasOpenai ? "OpenAI only" : hasVoyage ? "Voyage only" : "no space"}
                        {cov.openai_model ? ` · OpenAI model: ${cov.openai_model} (${cov.openai_chunks}/${cov.total_chunks} passages)` : ""}
                        {cov.voyage_model ? ` · Voyage model: ${cov.voyage_model} (${cov.voyage_chunks}/${cov.total_chunks} passages)` : ""}
                      </p>
                    )}
                    {doc.full_url && (
                      <a
                        href={doc.full_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary underline"
                      >
                        Open in Google Drive
                      </a>
                    )}
                    {loadingChunks && !docChunks ? (
                      <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading passages…
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {(docChunks ?? [])
                          .filter((c) => !needle || c.content.toLowerCase().includes(needle) || doc.title?.toLowerCase().includes(needle))
                          .map((chunk) => (
                            <div key={chunk.id} className="rounded-md border bg-muted/40 p-3">
                              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline">Passage {chunk.chunk_index + 1}</Badge>
                                <span>{chunk.char_count ?? chunk.content.length} characters</span>
                                {chunk.embedding_model && (
                                  <Badge variant="secondary">OpenAI: {chunk.embedding_model}</Badge>
                                )}
                                {chunk.embedding_voyage_model && (
                                  <Badge variant="secondary">Voyage: {chunk.embedding_voyage_model}</Badge>
                                )}
                              </div>
                              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                                {highlight(chunk.content)}
                              </p>
                            </div>
                          ))}
                        {docChunks && docChunks.length === 0 && (
                          <p className="text-sm text-muted-foreground">No passages stored for this file.</p>
                        )}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
};

export default IndexedPassagesBrowser;
