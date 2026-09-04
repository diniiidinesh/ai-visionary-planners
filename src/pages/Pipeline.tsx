import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ChunkInspector } from "@/components/pipeline/ChunkInspector";
import { EmbeddingLab } from "@/components/pipeline/EmbeddingLab";
import { LiveRun } from "@/components/pipeline/LiveRun";
import { ArrowLeft } from "lucide-react";

interface Stats {
  documents: number;
  chunks: number;
  voyageChunks: number;
  characters: number;
}

const Stage = ({
  n,
  title,
  input,
  output,
  children,
}: {
  n: number;
  title: string;
  input: string;
  output: string;
  children: React.ReactNode;
}) => (
  <Card id={`stage-${n}`}>
    <CardHeader>
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {n}
        </span>
        <CardTitle className="text-base">{title}</CardTitle>
      </div>
      <CardDescription className="pt-1">
        <span className="font-mono text-xs">
          {input} <span className="text-accent">→</span> {output}
        </span>
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</CardContent>
  </Card>
);

const Pipeline = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      const [{ count: documents }, { count: chunks }, { count: voyageChunks }, { data: sizes }] =
        await Promise.all([
          supabase.from("document_index").select("id", { count: "exact", head: true }).eq("ingest_status", "indexed"),
          supabase.from("document_chunks").select("id", { count: "exact", head: true }),
          supabase
            .from("document_chunks")
            .select("id", { count: "exact", head: true })
            .not("embedding_voyage", "is", null),
          supabase.from("document_chunks").select("char_count").limit(1000),
        ]);
      setStats({
        documents: documents ?? 0,
        chunks: chunks ?? 0,
        voyageChunks: voyageChunks ?? 0,
        characters: (sizes ?? []).reduce((sum, r) => sum + (r.char_count ?? 0), 0),
      });
    })();
  }, []);

  const avgChunk = stats && stats.chunks > 0 ? Math.round(stats.characters / Math.min(stats.chunks, 1000)) : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/search")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          <h1 className="text-sm font-semibold">How the pipeline works</h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">From a file in your Drive to a cited answer</CardTitle>
            <CardDescription>
              Every stage below takes one shape of information and turns it into another. The whole system is
              just nine of those transformations, chained. Numbers on this page come from your own index.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Documents indexed", value: stats?.documents ?? "…" },
                { label: "Chunks stored", value: stats?.chunks ?? "…" },
                { label: "Voyage vectors", value: stats?.voyageChunks ?? "…" },
                { label: "Avg chunk size", value: avgChunk ? `${avgChunk} chars` : "…" },
              ].map((s) => (
                <div key={s.label} className="rounded-md border p-3">
                  <p className="text-xl font-semibold text-foreground">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
{`INDEXING (runs when you click "Index my Drive")
  Drive file  →  raw bytes  →  plain text  →  chunks  →  vectors  →  Postgres rows

ANSWERING (runs on every question)
  question  →  standalone question + keyword queries
            →  query vector
            →  candidate chunks (vector list ⊕ keyword list, fused)
            →  reranked + capped shortlist
            →  prompt with numbered excerpts
            →  cited answer`}
            </pre>
          </CardContent>
        </Card>

        <LiveRun />

        <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Indexing — done once per file version
        </h2>

        <Stage
          n={1}
          title="Discovery: which files even exist"
          input="OAuth token"
          output="file list with id, name, mimeType, modifiedTime, owner, parents"
        >
          <p>
            The Drive API is asked for your files' <em>metadata only</em> — no content yet. That metadata is
            what makes incremental sync possible: <code>modifiedTime</code> tells us whether a file changed
            since the last run, and <code>parents</code> lets us reconstruct the folder path we later store
            as metadata on every chunk.
          </p>
          <p>
            <span className="font-medium text-foreground">Why metadata first:</span> downloading everything on
            every sync would cost minutes and money for files that didn't change. A cheap list call lets the
            expensive work be skipped for the 95% of files that are untouched.
          </p>
        </Stage>

        <Stage
          n={2}
          title="Extraction: bytes become plain text"
          input="PDF / .docx / .xlsx / Google Doc / CSV bytes"
          output="one long UTF-8 string, tables as markdown"
        >
          <p>
            Each format needs a different door. Google-native files are exported through Drive's export
            endpoint (a Google Doc has no file on disk to download). PDFs go through a text-layer parser.
            Office files are ZIP archives of XML — they're unzipped in memory and the text nodes pulled out.
            CSV is parsed as rows.
          </p>
          <p>
            <span className="font-medium text-foreground">The important transformation here is tables.</span>{" "}
            A spreadsheet flattened naively becomes <code>Q1 100 Q2 150</code> — a string where the link
            between label and number is destroyed. Instead tables are rebuilt as markdown pipe-tables, so the
            row/column relationship survives into the chunk, into the vector, and into the prompt. This is why
            the answer model can read your spreadsheets at all.
          </p>
          <p>
            <span className="font-medium text-foreground">Constraints:</span> scanned PDFs have no text layer
            (nothing to extract — they'd need OCR), files above the size cap are skipped to avoid blowing the
            function's memory, and anything under ~30 characters is dropped as noise.
          </p>
        </Stage>

        <Stage
          n={3}
          title="Chunking: one long string becomes many retrievable passages"
          input="a 40,000-character document"
          output="~35 chunks of ~1,200 chars, 200 chars of overlap, each tagged with its heading"
        >
          <p>
            A whole document is the wrong unit to search. One vector for 40,000 characters is an average of
            every topic in the file — it matches everything weakly and nothing strongly. Chunks give each
            idea its own address.
          </p>
          <p>
            The splitter tries the most meaningful boundary first and degrades: paragraph breaks → sentence
            ends → hard character cut. Headings are carried down onto every chunk beneath them, so a passage
            that says only "it grew 12%" still knows it lives under "Q3 Revenue".
          </p>
          <p>
            <span className="font-medium text-foreground">Overlap</span> exists because boundaries are
            arbitrary. If a definition starts at character 1,190, a clean cut would leave the term in one
            chunk and its meaning in the next, and neither would match the question. Repeating the last 200
            characters into the next chunk makes both halves individually answerable. The cost is ~17% more
            storage and embedding spend — cheap insurance.
          </p>
          <ChunkInspector />
        </Stage>

        <Stage
          n={4}
          title="Embedding: text becomes coordinates"
          input="a chunk of text"
          output="an array of 3,072 (OpenAI) or 1,024 (Voyage) floats"
        >
          <p>
            An embedding model reads a passage and outputs a point in high-dimensional space, positioned so
            that passages meaning similar things land near each other — even with zero words in common.
            "Revenue climbed" and "sales were up" are neighbours; "revenue" and "revenge" are not. That is the
            entire trick, and it's why this beats keyword search on paraphrased questions.
          </p>
          <p>
            <span className="font-medium text-foreground">Dimensions are a real trade-off.</span> More
            dimensions = more nuance retained, but linearly more storage, more index memory and slower
            distance math. 3,072 floats × 4 bytes = ~12 KB per chunk before indexing; Voyage's 1,024 dims are
            a third of that at broadly comparable retrieval quality on benchmarks — which is exactly what the
            lab at the bottom of this page lets you check on <em>your</em> documents rather than on a
            benchmark.
          </p>
          <p>
            <span className="font-medium text-foreground">Asymmetry:</span> Voyage is told whether it's
            embedding a stored document or a live query (<code>input_type</code>), because questions and
            answers are written differently — a question rarely looks like the sentence that answers it.
            OpenAI has no such switch.
          </p>
          <p>
            <span className="font-medium text-foreground">Hard constraint:</span> vectors from two different
            models are not comparable — the axes mean different things. That's why both spaces are stored
            side by side per chunk rather than one being converted into the other, and why changing embedding
            model forces a full re-index.
          </p>
        </Stage>

        <Stage
          n={5}
          title="Storage: vectors become searchable rows"
          input="chunk text + vector + metadata"
          output="a Postgres row with an HNSW index and a tsvector"
        >
          <p>
            Each chunk is one row: the text, both vectors, the source file, heading, author, folder path,
            modified date, and the pipeline settings used to build it. Those settings are how the app knows a
            chunk is stale when you change chunk size or embedding model.
          </p>
          <p>
            <span className="font-medium text-foreground">Two indexes, two search styles.</span> An HNSW index
            makes nearest-neighbour lookup approximate-but-instant (comparing against all chunks exactly would
            be a full table scan on every question). A GIN index over a <code>tsvector</code> column powers
            literal keyword matching. HNSW caps at 2,000 dimensions for standard vectors, which is why the
            3,072-dim OpenAI column is indexed through a <code>halfvec</code> cast — 16-bit floats, half the
            memory, negligible recall loss. The 1,024-dim Voyage column needs no such trick.
          </p>
        </Stage>

        <Separator />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Answering — runs on every question
        </h2>

        <Stage
          n={6}
          title="Query planning: your question becomes two different questions"
          input='"and what about the second one?"'
          output='standalone question + 2-4 keyword queries + a route'
        >
          <p>
            One model call does three jobs. First it resolves conversational references into a question that
            stands alone — "the second one" is meaningless to a vector search, so prior turns are folded in.
            Second it produces short keyword queries, because the two retrieval channels want opposite
            shapes: the vector channel likes a full natural sentence, while Postgres full-text search ANDs
            every term, so a long question matches literally nothing.
          </p>
          <p>
            <span className="font-medium text-foreground">Third, it picks the route.</span> Most questions are
            a <code>lookup</code> — "what do the documents say about X" — and continue into stages 7-9. But a
            question about the <em>collection itself</em> ("what does my Drive contain?", "how many documents
            are indexed?") is classified <code>corpus_overview</code> and skips retrieval entirely, answering
            from the document catalog instead.
          </p>
          <p>
            <span className="font-medium text-foreground">Why it can't just be retrieved.</span> Stage 9 caps
            what reaches the model at ~10 passages, at most 3 per document. Ask what's in a 60-document Drive
            and retrieval would show the model four files, which it would then describe as though they were
            everything — confidently, because nothing tells it otherwise. The catalog already stores the exact
            answer as structured data, so that class of question is routed there. Classification rides along
            in this same call, so it costs no extra latency or spend, and anything ambiguous falls back to{" "}
            <code>lookup</code> — the harmless direction.
          </p>
        </Stage>

        <Stage
          n={7}
          title="Hybrid retrieval: two ranked lists become one"
          input="query vector + keyword queries"
          output="~20 candidate chunks with a fused score"
        >
          <p>
            The semantic channel returns chunks by cosine distance. The keyword channel returns chunks
            containing the literal terms — which is what saves you on invoice numbers, error codes, product
            SKUs and surnames, where semantics are useless and exact match is everything.
          </p>
          <p>
            <span className="font-medium text-foreground">The two scores can't be added:</span> cosine
            similarity and text-search rank are different scales with different distributions. So the fusion
            ignores scores and uses <em>positions</em> — Reciprocal Rank Fusion, where each list contributes{" "}
            <code>weight / (60 + rank)</code>. A chunk ranked #1 by both wins; a chunk ranked #1 by one and
            #40 by the other still beats a chunk that was mediocre in both. The constant 60 flattens the top
            so the very top result of one channel can't dominate outright.
          </p>
          <p>Retrieval mode in AI Settings just sets those two weights to (1,1), (1,0) or (0,1).</p>
        </Stage>

        <Stage
          n={8}
          title="Reranking and capping: candidates become a shortlist"
          input="~20 candidates"
          output="the passages actually sent to the model"
        >
          <p>
            Retrieval scored your question and each chunk <em>separately</em> — the vectors were computed
            without ever seeing each other. A cross-encoder reranker reads question and passage{" "}
            <em>together</em> and scores the pair, which is far more accurate and far too slow to run over
            your whole index. Hence the two-stage shape: cheap search narrows thousands to twenty, expensive
            model reorders twenty.
          </p>
          <p>
            Then a per-document cap is applied so one verbose file can't occupy every slot and starve the
            answer of other sources.
          </p>
        </Stage>

        <Stage
          n={9}
          title="Generation: passages become a cited answer"
          input="numbered excerpts + your question + rules"
          output="markdown answer with [n] citations and a confidence flag"
        >
          <p>
            Each passage is wrapped in a header giving its document, section, author, date and URL, then
            numbered. The instructions forbid outside knowledge, require a bracket citation per claim, and
            require an explicit "not in the documents" answer when the excerpts don't cover it — that refusal
            path is what stops confident invention.
          </p>
          <p>
            Temperature controls how deterministic the wording is (low, because this is extraction, not
            creative writing). Finally the answer, its sources and the token usage are written to the
            database so the run is auditable.
          </p>
        </Stage>

        <Separator />
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Compare the two embedding models
          </h2>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">OpenAI text-embedding-3-large · 3,072d · 8k token input</Badge>
            <Badge variant="outline">Voyage voyage-3-large · 1,024d · query/document asymmetry</Badge>
            {stats && stats.voyageChunks === 0 && (
              <Badge variant="destructive">No Voyage vectors yet — run a full re-index first</Badge>
            )}
          </div>
        </div>
        <EmbeddingLab />
      </main>
    </div>
  );
};

export default Pipeline;