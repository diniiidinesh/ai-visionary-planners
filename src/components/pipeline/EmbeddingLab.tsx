import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, FlaskConical } from "lucide-react";
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
}

const key = (c: Candidate) => `${c.title}#${c.chunkIndex}`;

const num = (v: number | null | undefined, digits = 3) =>
  v === null || v === undefined ? "—" : Number(v).toFixed(digits);

export const EmbeddingLab = () => {
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunResult[]>([]);

  const runOne = async (space: Space): Promise<RunResult> => {
    const started = performance.now();
    const { data, error } = await supabase.functions.invoke("rag-answer", {
      body: {
        question,
        overrides: { embeddingProvider: space, debugRetrieval: true, retrievalMode: "hybrid" },
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
    };
  };

  const run = async () => {
    if (!question.trim()) return;
    setRunning(true);
    setResults([]);
    try {
      const openai = await runOne("openai");
      const voyage = await runOne("voyage");
      setResults([openai, voyage]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setRunning(false);
    }
  };

  const [a, b] = results;
  const setA = new Set((a?.candidates ?? []).map(key));
  const setB = new Set((b?.candidates ?? []).map(key));
  const shared = [...setA].filter((k) => setB.has(k)).length;
  const union = new Set([...setA, ...setB]).size;
  const jaccard = union > 0 ? shared / union : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4" /> Embedding A/B lab
        </CardTitle>
        <CardDescription>
          Runs the same question twice — identical chunks, identical keyword channel, identical reranker,
          identical answer model. The only variable is which vector space the semantic channel searches.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask something your documents actually cover…"
            onKeyDown={(e) => e.key === "Enter" && !running && run()}
          />
          <Button onClick={run} disabled={running || !question.trim()}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Compare
          </Button>
        </div>

        {results.length === 2 && (
          <>
            <Alert>
              <AlertDescription className="text-xs">
                <span className="font-medium">Retrieval agreement: {(jaccard * 100).toFixed(0)}%</span> —{" "}
                {shared} of {union} distinct candidate chunks were found by both spaces. Low agreement is not
                automatically bad: it means the two models disagree about what "similar" means, and the
                answers below are what actually matter.
              </AlertDescription>
            </Alert>

            <div className="grid gap-4 lg:grid-cols-2">
              {results.map((r) => (
                <div key={r.space} className="space-y-3 rounded-md border p-3">
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

                  {r.retrievalQuery && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Rewritten query:</span> {r.retrievalQuery}
                    </p>
                  )}
                  {r.keywordQueries && r.keywordQueries.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Keyword queries:</span> {r.keywordQueries.join(" | ")}
                    </p>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="py-1 pr-2">#</th>
                          <th className="py-1 pr-2">Chunk</th>
                          <th className="py-1 pr-2">cos</th>
                          <th className="py-1 pr-2">kw</th>
                          <th className="py-1 pr-2">RRF</th>
                          <th className="py-1">rerank</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.candidates.slice(0, 12).map((c, i) => {
                          const other = r.space === "openai" ? setB : setA;
                          const onlyHere = !other.has(key(c));
                          return (
                            <tr key={`${key(c)}-${i}`} className={c.used ? "font-medium" : "text-muted-foreground"}>
                              <td className="py-1 pr-2">{i + 1}</td>
                              <td className="py-1 pr-2">
                                <span className="line-clamp-1">{c.title} #{c.chunkIndex}</span>
                                {onlyHere && <span className="text-accent"> ·only here</span>}
                              </td>
                              <td className="py-1 pr-2 font-mono">{num(c.similarity)}</td>
                              <td className="py-1 pr-2 font-mono">{num(c.keywordScore)}</td>
                              <td className="py-1 pr-2 font-mono">{num(c.fusedScore, 4)}</td>
                              <td className="py-1 font-mono">{num(c.rerankScore)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Answer ({r.chunksUsed} passages · {r.model})
                    </p>
                    <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">
                      {r.summary}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};