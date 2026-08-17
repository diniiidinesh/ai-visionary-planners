import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Loader2, Play, RotateCcw, Check, CircleDashed } from "lucide-react";
import { toast } from "sonner";

interface Candidate {
  title: string;
  heading: string | null;
  chunkIndex: number;
  similarity: number | null;
  keywordScore: number | null;
  vectorRank: number | null;
  keywordRank: number | null;
  fusedScore: number | null;
  rerankScore: number | null;
  used: boolean;
  preview: string;
}

interface Excerpt {
  ref: number;
  title: string;
  heading: string | null;
  author: string | null;
  modifiedTime: string | null;
  url: string | null;
  similarity: number | null;
  content: string;
}

interface Retrieval {
  mode: string;
  embeddingSpace: string;
  embeddingModel: string;
  embeddingFallback: string | null;
  candidates: Candidate[];
  reranked: boolean;
  retrievalQuery: string | null;
  keywordQueries: string[] | null;
}

interface Turn {
  question: string;
  answer: string;
  ms: number;
  model?: string;
  chunksUsed: number;
  settings?: Record<string, unknown>;
  excerpts: Excerpt[];
  retrieval: Retrieval | null;
}

const STAGES = [
  { n: 1, label: "Understand the question" },
  { n: 2, label: "Rewrite into a standalone search query" },
  { n: 3, label: "Embed the query into a vector" },
  { n: 4, label: "Semantic search over chunk vectors" },
  { n: 5, label: "Keyword search over the same chunks" },
  { n: 6, label: "Fuse both rankings (RRF)" },
  { n: 7, label: "Rerank + cap per document" },
  { n: 8, label: "Build the prompt from excerpts" },
  { n: 9, label: "Generate the cited answer" },
];

const num = (v: number | null | undefined, d = 3) =>
  v === null || v === undefined ? "—" : Number(v).toFixed(d);

const StageRow = ({
  n,
  label,
  state,
  children,
}: {
  n: number;
  label: string;
  state: "pending" | "active" | "done";
  children?: React.ReactNode;
}) => (
  <AccordionItem value={`s${n}`} disabled={state !== "done"}>
    <AccordionTrigger className="py-2 text-left text-sm hover:no-underline">
      <span className="flex items-center gap-2">
        {state === "done" ? (
          <Check className="h-4 w-4 text-primary" />
        ) : state === "active" ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <CircleDashed className="h-4 w-4 text-muted-foreground/50" />
        )}
        <span className="font-mono text-xs text-muted-foreground">{n}</span>
        <span className={state === "pending" ? "text-muted-foreground/60" : ""}>{label}</span>
      </span>
    </AccordionTrigger>
    <AccordionContent className="space-y-3 text-sm text-muted-foreground">{children}</AccordionContent>
  </AccordionItem>
);

const CandidateTable = ({
  rows,
  sortKey,
  highlightUsed,
}: {
  rows: Candidate[];
  sortKey: "vectorRank" | "keywordRank" | "fusedScore" | "rerankScore";
  highlightUsed?: boolean;
}) => {
  const sorted = [...rows]
    .filter((r) =>
      sortKey === "vectorRank"
        ? r.vectorRank !== null
        : sortKey === "keywordRank"
          ? r.keywordRank !== null
          : true,
    )
    .sort((a, b) => {
      if (sortKey === "vectorRank") return (a.vectorRank ?? 1e9) - (b.vectorRank ?? 1e9);
      if (sortKey === "keywordRank") return (a.keywordRank ?? 1e9) - (b.keywordRank ?? 1e9);
      return (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0);
    })
    .slice(0, 12);

  if (sorted.length === 0) return <p className="text-xs">This channel returned nothing for this question.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th className="py-1 pr-2 text-left">#</th>
            <th className="py-1 pr-2 text-left">Passage</th>
            <th className="py-1 pr-2 text-right">cosine</th>
            <th className="py-1 pr-2 text-right">keyword</th>
            <th className="py-1 pr-2 text-right">RRF</th>
            <th className="py-1 pr-2 text-right">rerank</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => (
            <tr
              key={`${c.title}#${c.chunkIndex}`}
              className={`border-b border-border/50 ${highlightUsed && c.used ? "bg-primary/5" : ""}`}
            >
              <td className="py-1 pr-2 font-mono">{i + 1}</td>
              <td className="py-1 pr-2">
                <span className="font-medium text-foreground">{c.title}</span>
                <span className="text-muted-foreground"> · chunk {c.chunkIndex}</span>
                {c.heading && <span className="text-muted-foreground"> · {c.heading}</span>}
              </td>
              <td className="py-1 pr-2 text-right font-mono">{num(c.similarity)}</td>
              <td className="py-1 pr-2 text-right font-mono">{num(c.keywordScore, 4)}</td>
              <td className="py-1 pr-2 text-right font-mono">{num(c.fusedScore, 4)}</td>
              <td className="py-1 pr-2 text-right font-mono">{num(c.rerankScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const LiveRun = () => {
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [activeStage, setActiveStage] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const timer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const run = async () => {
    const q = question.trim();
    if (!q) return;
    setRunning(true);
    setQuestion("");
    setActiveStage(1);
    timer.current = window.setInterval(() => {
      setActiveStage((s) => (s >= 9 ? 9 : s + 1));
    }, 900);

    const history = turns
      .slice(-4)
      .flatMap((t) => [
        { role: "user" as const, content: t.question.slice(0, 4000) },
        { role: "assistant" as const, content: t.answer.slice(0, 4000) },
      ]);

    const started = performance.now();
    try {
      const { data, error } = await supabase.functions.invoke("rag-answer", {
        body: { question: q, history, overrides: { debugRetrieval: true } },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setTurns((prev) => [
        ...prev,
        {
          question: q,
          answer: data.summary ?? "",
          ms: Math.round(performance.now() - started),
          model: data.model,
          chunksUsed: data.chunksUsed ?? 0,
          settings: data.settings,
          excerpts: (data.excerpts ?? []) as Excerpt[],
          retrieval: (data.retrieval ?? null) as Retrieval | null,
        },
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Run failed");
    } finally {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
      setRunning(false);
      setActiveStage(0);
      inputRef.current?.focus();
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Play className="h-4 w-4" /> Live run — watch a real question move through the pipeline
            </CardTitle>
            <CardDescription>
              Ask anything your indexed documents cover. Each turn below is a real call, expanded stage by
              stage with the actual data that stage produced. Follow-ups keep the conversation, so you can
              see how "and what about that?" gets rewritten into a standalone search query.
            </CardDescription>
          </div>
          {turns.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setTurns([])}>
              <RotateCcw className="mr-2 h-4 w-4" /> New conversation
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            ref={inputRef}
            autoFocus
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={turns.length ? "Ask a follow-up…" : "Ask a question about your documents…"}
            onKeyDown={(e) => e.key === "Enter" && !running && run()}
          />
          <Button onClick={run} disabled={running || !question.trim()}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Run
          </Button>
        </div>

        {running && (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-xs text-muted-foreground">Running…</p>
            <ul className="space-y-1">
              {STAGES.map((s) => (
                <li key={s.n} className="flex items-center gap-2 text-sm">
                  {s.n < activeStage ? (
                    <Check className="h-4 w-4 text-primary" />
                  ) : s.n === activeStage ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <CircleDashed className="h-4 w-4 text-muted-foreground/40" />
                  )}
                  <span className={s.n > activeStage ? "text-muted-foreground/50" : ""}>{s.label}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Stage highlighting is indicative — the backend answers in a single call, so exact per-stage
              data appears below the moment the run finishes.
            </p>
          </div>
        )}

        {turns.map((t, ti) => {
          const r = t.retrieval;
          const cands = r?.candidates ?? [];
          return (
            <div key={ti} className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Turn {ti + 1}</Badge>
                <Badge variant="outline">{t.ms} ms</Badge>
                {t.model && <span className="font-mono text-xs text-muted-foreground">{t.model}</span>}
                {r && <Badge variant="outline">{r.mode} · {r.embeddingSpace}</Badge>}
              </div>
              <p className="text-sm font-medium">{t.question}</p>

              {r?.embeddingFallback && (
                <Alert variant="destructive">
                  <AlertDescription className="text-xs">{r.embeddingFallback}</AlertDescription>
                </Alert>
              )}

              <Accordion type="multiple" className="w-full">
                <StageRow n={1} label="Understand the question" state="done">
                  <p>
                    Raw input sent to the backend, with the last {Math.min(ti, 4) * 2} prior message(s) as
                    conversation context.
                  </p>
                  <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs text-foreground">{t.question}</pre>
                </StageRow>

                <StageRow n={2} label="Rewrite into a standalone search query" state="done">
                  <p>
                    {r?.retrievalQuery
                      ? "The planner rewrote your wording into a self-contained query — this is what gets embedded and searched, not your literal sentence."
                      : "The planner left your question as-is: it was already standalone and specific enough to search with."}
                  </p>
                  <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs text-foreground">
                    {r?.retrievalQuery ?? t.question}
                  </pre>
                  {r?.keywordQueries?.length ? (
                    <p className="text-xs">
                      <span className="font-medium">Keyword variants:</span> {r.keywordQueries.join(" | ")}
                    </p>
                  ) : null}
                </StageRow>

                <StageRow n={3} label="Embed the query into a vector" state="done">
                  <p>
                    Model <code>{r?.embeddingModel}</code> turned that text into a single list of numbers.
                    Every chunk in your index was turned into a comparable list at ingest time; "relevance"
                    is just the angle between two of these lists.
                  </p>
                  <p className="text-xs">
                    Query embeddings are computed fresh on every run — that is a chunk of this turn's{" "}
                    {t.ms} ms.
                  </p>
                </StageRow>

                <StageRow n={4} label="Semantic search over chunk vectors" state="done">
                  <p>Nearest chunks by cosine similarity, before any keyword input:</p>
                  <CandidateTable rows={cands} sortKey="vectorRank" />
                </StageRow>

                <StageRow n={5} label="Keyword search over the same chunks" state="done">
                  <p>Same chunks, ranked instead by literal term match (Postgres full-text):</p>
                  <CandidateTable rows={cands} sortKey="keywordRank" />
                </StageRow>

                <StageRow n={6} label="Fuse both rankings (RRF)" state="done">
                  <p>
                    Positions, not scores, are combined: each list contributes <code>weight / (60 + rank)</code>.
                    Chunks found by both channels rise to the top.
                  </p>
                  <CandidateTable rows={cands} sortKey="fusedScore" />
                </StageRow>

                <StageRow n={7} label="Rerank + cap per document" state="done">
                  <p>
                    {r?.reranked
                      ? "A cross-encoder read the question and each candidate together and rescored them; then a per-document cap stopped one file from taking every slot."
                      : "No reranker ran for this turn — the fused order was used directly, capped per document."}
                  </p>
                  <CandidateTable rows={cands} sortKey={r?.reranked ? "rerankScore" : "fusedScore"} highlightUsed />
                  <p className="text-xs">Highlighted rows are the {t.chunksUsed} passages that survived.</p>
                </StageRow>

                <StageRow n={8} label="Build the prompt from excerpts" state="done">
                  <p>Exactly this text was handed to the answer model, numbered for citation:</p>
                  <div className="space-y-2">
                    {t.excerpts.map((e) => (
                      <div key={e.ref} className="rounded border bg-muted/40 p-2">
                        <p className="text-xs font-medium text-foreground">
                          [{e.ref}] {e.title}
                          {e.heading ? ` · ${e.heading}` : ""}
                          {e.author ? ` · ${e.author}` : ""}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-xs">{e.content.slice(0, 600)}
                          {e.content.length > 600 ? "…" : ""}
                        </p>
                      </div>
                    ))}
                    {t.excerpts.length === 0 && <p className="text-xs">No passages passed the threshold.</p>}
                  </div>
                </StageRow>

                <StageRow n={9} label="Generate the cited answer" state="done">
                  <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs text-foreground">{t.answer}</pre>
                </StageRow>
              </Accordion>

              <Separator />
              <p className="whitespace-pre-wrap text-sm text-foreground">{t.answer}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
