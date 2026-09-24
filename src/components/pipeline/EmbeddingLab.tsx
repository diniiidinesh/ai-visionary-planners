import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { demoHeaders } from "@/lib/demo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Loader2, FlaskConical, RotateCcw, Check, CircleDashed } from "lucide-react";
import { toast } from "sonner";

type Space = "openai" | "voyage";

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
  content: string;
}

interface RunResult {
  space: Space;
  ms: number;
  summary: string;
  chunksUsed: number;
  model?: string;
  embeddingModel?: string;
  embeddingFallback?: string | null;
  reranked?: boolean;
  retrievalQuery?: string | null;
  keywordQueries?: string[] | null;
  candidates: Candidate[];
  excerpts: Excerpt[];
}

interface Turn {
  question: string;
  openai: RunResult;
  voyage: RunResult;
}

const key = (c: Candidate) => `${c.title}#${c.chunkIndex}`;

const num = (v: number | null | undefined, digits = 3) =>
  v === null || v === undefined ? "—" : Number(v).toFixed(digits);

const STAGES = [
  "Understand the question and classify the route",
  "Rewrite into a standalone search query",
  "Embed the query into each vector space",
  "Semantic search over chunk vectors",
  "Keyword search over the same chunks",
  "Fuse both rankings (RRF)",
  "Rerank + cap per document",
  "Build the prompt from excerpts",
  "Generate both cited answers",
];

const StageRow = ({
  n,
  label,
  children,
}: {
  n: number;
  label: string;
  children?: React.ReactNode;
}) => (
  <AccordionItem value={`s${n}`}>
    <AccordionTrigger className="py-2 text-left text-sm hover:no-underline">
      <span className="flex items-center gap-2">
        <Check className="h-4 w-4 text-primary" />
        <span className="font-mono text-xs text-muted-foreground">{n}</span>
        <span>{label}</span>
      </span>
    </AccordionTrigger>
    <AccordionContent className="space-y-3 text-sm text-muted-foreground">{children}</AccordionContent>
  </AccordionItem>
);

const CandidateTable = ({
  rows,
  sortKey,
  otherSet,
  highlightUsed,
}: {
  rows: Candidate[];
  sortKey: "vectorRank" | "keywordRank" | "fusedScore" | "rerankScore";
  otherSet?: Set<string>;
  highlightUsed?: boolean;
}) => {
  const sorted = [...rows]
    .filter((r) =>
      sortKey === "vectorRank" ? r.vectorRank !== null : sortKey === "keywordRank" ? r.keywordRank !== null : true,
    )
    .sort((a, b) => {
      if (sortKey === "vectorRank") return (a.vectorRank ?? 1e9) - (b.vectorRank ?? 1e9);
      if (sortKey === "keywordRank") return (a.keywordRank ?? 1e9) - (b.keywordRank ?? 1e9);
      return (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0);
    })
    .slice(0, 10);

  if (sorted.length === 0) return <p className="text-xs">Nothing returned on this channel.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">Passage</th>
            <th className="py-1 pr-2 text-right">cos</th>
            <th className="py-1 pr-2 text-right">kw</th>
            <th className="py-1 pr-2 text-right">RRF</th>
            <th className="py-1 text-right">rerank</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => (
            <tr
              key={`${key(c)}-${i}`}
              className={`border-b border-border/50 ${highlightUsed && c.used ? "bg-primary/5" : ""}`}
            >
              <td className="py-1 pr-2 font-mono">{i + 1}</td>
              <td className="py-1 pr-2">
                <span className="font-medium text-foreground">{c.title}</span>
                <span className="text-muted-foreground"> · chunk {c.chunkIndex}</span>
                {otherSet && !otherSet.has(key(c)) && <span className="text-accent"> · only here</span>}
              </td>
              <td className="py-1 pr-2 text-right font-mono">{num(c.similarity)}</td>
              <td className="py-1 pr-2 text-right font-mono">{num(c.keywordScore, 4)}</td>
              <td className="py-1 pr-2 text-right font-mono">{num(c.fusedScore, 4)}</td>
              <td className="py-1 text-right font-mono">{num(c.rerankScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const SpaceColumn = ({
  r,
  otherSet,
  question,
}: {
  r: RunResult;
  otherSet: Set<string>;
  question: string;
}) => (
  <div className="space-y-3 rounded-md border p-3">
    <div className="flex flex-wrap items-center gap-2">
      <Badge>{r.space === "openai" ? "OpenAI space" : "Voyage space"}</Badge>
      <span className="font-mono text-xs text-muted-foreground">{r.embeddingModel}</span>
      <Badge variant="outline">{r.ms} ms</Badge>
      {r.reranked && <Badge variant="secondary">reranked</Badge>}
    </div>

    {r.embeddingFallback && (
      <Alert variant="destructive">
        <AlertDescription className="text-xs">{r.embeddingFallback}</AlertDescription>
      </Alert>
    )}

    <Accordion type="multiple" className="w-full">
      <StageRow n={1} label="Understand the question and classify the route">
        <p>
          The query planner first decides whether this asks about the whole collection or needs evidence from
          document passages.
        </p>
        <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs text-foreground">{question}</pre>
        <p className="text-xs">
          This lab forces <code>lookup</code> after classification so the OpenAI and Voyage embedding paths can
          be compared. A <code>corpus_overview</code> run skips embeddings and would be identical in both columns.
        </p>
      </StageRow>

      <StageRow n={2} label="Rewrite into a standalone search query">
        <p>
          {r.retrievalQuery
            ? "The planner rewrote the question using the conversation history so it can be searched on its own."
            : "The question was already standalone, so it was used as written."}
        </p>
        <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs text-foreground">
          {r.retrievalQuery ?? question}
        </pre>
        {r.keywordQueries?.length ? (
          <p className="text-xs"><span className="font-medium">Keyword variants:</span> {r.keywordQueries.join(" | ")}</p>
        ) : null}
      </StageRow>

      <StageRow n={3} label="Embed the query into a vector">
        <p>
          <code>{r.embeddingModel}</code> turned the standalone query into coordinates in the {r.space === "openai" ? "OpenAI" : "Voyage"} vector space.
        </p>
      </StageRow>

      <StageRow n={4} label="Semantic search over chunk vectors">
        <p>Nearest passages by cosine similarity in this embedding space:</p>
        <CandidateTable rows={r.candidates} sortKey="vectorRank" otherSet={otherSet} />
      </StageRow>

      <StageRow n={5} label="Keyword search over the same chunks">
        <p>The literal full-text channel is shared by both columns; differences marked “only here” come from the candidate pool.</p>
        <CandidateTable rows={r.candidates} sortKey="keywordRank" otherSet={otherSet} />
      </StageRow>

      <StageRow n={6} label="Fuse both rankings (RRF)">
        <p>Semantic and keyword positions are combined with <code>weight / (60 + rank)</code>.</p>
        <CandidateTable rows={r.candidates} sortKey="fusedScore" otherSet={otherSet} />
      </StageRow>

      <StageRow n={7} label="Rerank + cap per document">
        <p>
          {r.reranked
            ? "The Voyage cross-encoder rescored the fused candidates, then the per-document cap prevented one file from filling the prompt."
            : "No reranker ran; the fused order was capped per document."}
        </p>
          <CandidateTable
            rows={r.candidates}
            sortKey={r.reranked ? "rerankScore" : "fusedScore"}
            otherSet={otherSet}
            highlightUsed
          />
        <p className="text-xs">Highlighted rows are the {r.chunksUsed} passages that survived.</p>
      </StageRow>

      <StageRow n={8} label="Build the prompt from excerpts">
        <p>Exactly these numbered passages were handed to the answer model:</p>
        <div className="space-y-2">
          {r.excerpts.map((e) => (
            <div key={e.ref} className="rounded border bg-muted/40 p-2">
              <p className="text-xs font-medium text-foreground">
                [{e.ref}] {e.title}
                {e.heading ? ` · ${e.heading}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-xs">
                {e.content.slice(0, 400)}
                {e.content.length > 400 ? "…" : ""}
              </p>
            </div>
          ))}
          {r.excerpts.length === 0 && <p className="text-xs">No passages passed the threshold.</p>}
        </div>
      </StageRow>

      <StageRow n={9} label="Generate the cited answer">
        <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs text-foreground">{r.summary}</pre>
      </StageRow>
    </Accordion>

    <Separator />
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        Answer ({r.chunksUsed} passages · {r.model})
      </p>
      <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">{r.summary}</p>
    </div>
  </div>
);

export const EmbeddingLab = () => {
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [activeStage, setActiveStage] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const timer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const historyFor = (space: Space) =>
    turns.slice(-4).flatMap((t) => [
      { role: "user" as const, content: t.question.slice(0, 4000) },
      { role: "assistant" as const, content: t[space].summary.slice(0, 4000) },
    ]);

  const runOne = async (space: Space, q: string): Promise<RunResult> => {
    const started = performance.now();
    const { data, error } = await supabase.functions.invoke("rag-answer", {
      headers: demoHeaders(),
      body: {
        question: q,
        history: historyFor(space),
        // Pinned to the retrieval path on purpose. This lab exists to compare
        // two embedding spaces, and a corpus-overview question would skip
        // embedding entirely — leaving both panes with identical answers and
        // nothing to compare. Forcing 'lookup' keeps the comparison meaningful
        // whatever gets typed in.
        overrides: {
          embeddingProvider: space,
          debugRetrieval: true,
          retrievalMode: "hybrid",
          intent: "lookup",
        },
      },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return {
      space,
      ms: Math.round(performance.now() - started),
      summary: data.summary ?? "",
      chunksUsed: data.chunksUsed ?? 0,
      model: data.model,
      embeddingModel: data.retrieval?.embeddingModel,
      embeddingFallback: data.retrieval?.embeddingFallback ?? null,
      reranked: data.retrieval?.reranked,
      retrievalQuery: data.retrieval?.retrievalQuery ?? null,
      keywordQueries: data.retrieval?.keywordQueries ?? null,
      candidates: (data.retrieval?.candidates ?? []) as Candidate[],
      excerpts: (data.excerpts ?? []) as Excerpt[],
    };
  };

  const run = async () => {
    const q = question.trim();
    if (!q) return;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      toast.error("Please sign in to run the comparison.");
      return;
    }
    setRunning(true);
    setQuestion("");
    setActiveStage(1);
    timer.current = window.setInterval(() => {
      setActiveStage((s) => (s >= STAGES.length ? STAGES.length : s + 1));
    }, 1200);

    try {
      const openai = await runOne("openai", q);
      const voyage = await runOne("voyage", q);
      setTurns((prev) => [...prev, { question: q, openai, voyage }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Comparison failed");
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
              <FlaskConical className="h-4 w-4" /> Embedding A/B lab — conversational compare
            </CardTitle>
            <CardDescription>
              Every turn runs the same question twice — identical chunks, keyword channel, reranker and answer
              model. The only variable is which vector space the semantic channel searches. Follow-ups are
              supported: each space carries its own conversation history, so you can see the two branches
              diverge over a real dialogue.
              <span className="mt-2 block">
                The same route filter runs first in both tools. Live run follows its result; this lab pins the
                result to <code>lookup</code>, because <code>corpus_overview</code> skips embeddings and would
                produce identical columns. Use Live run above to exercise both branches.
              </span>
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
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={turns.length ? "Ask a follow-up…" : "Ask something your documents actually cover…"}
            onKeyDown={(e) => e.key === "Enter" && !running && run()}
          />
          <Button onClick={run} disabled={running || !question.trim()}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Compare
          </Button>
        </div>

        {running && (
          <div className="rounded-md border p-3">
            <ul className="space-y-1">
              {STAGES.map((label, i) => {
                const n = i + 1;
                return (
                  <li key={label} className="flex items-center gap-2 text-sm">
                    {n < activeStage ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : n === activeStage ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <CircleDashed className="h-4 w-4 text-muted-foreground/40" />
                    )}
                    <span className={n > activeStage ? "text-muted-foreground/50" : ""}>{label}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Both spaces run sequentially — full per-stage data appears below when the turn finishes.
            </p>
          </div>
        )}

        {turns.map((t, ti) => {
          const setA = new Set(t.openai.candidates.map(key));
          const setB = new Set(t.voyage.candidates.map(key));
          const shared = [...setA].filter((k) => setB.has(k)).length;
          const union = new Set([...setA, ...setB]).size;
          const jaccard = union > 0 ? shared / union : 0;
          return (
            <div key={ti} className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Turn {ti + 1}</Badge>
                <Badge variant="outline">{t.openai.ms + t.voyage.ms} ms total</Badge>
              </div>
              <p className="text-sm font-medium">{t.question}</p>

              <Alert>
                <AlertDescription className="text-xs">
                  <span className="font-medium">Retrieval agreement: {(jaccard * 100).toFixed(0)}%</span> — {shared}{" "}
                  of {union} distinct candidate chunks were found by both spaces. Low agreement is not
                  automatically bad: it means the two models disagree about what "similar" means, and the answers
                  are what actually matter.
                </AlertDescription>
              </Alert>

              <div className="grid gap-4 lg:grid-cols-2">
                <SpaceColumn r={t.openai} otherSet={setB} question={t.question} />
                <SpaceColumn r={t.voyage} otherSet={setA} question={t.question} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
