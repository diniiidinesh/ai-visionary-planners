// Runs the golden set against the deployed rag-answer function and reports
// retrieval, answer-quality, and guardrail metrics.
//
//   EVAL_EMAIL=... EVAL_PASSWORD=... node run-eval.mjs
//
// Options: --set FILE        golden set (default golden-set.json)
//          --k N             cutoff for @k metrics (default 10 = passagesToModel)
//          --judge           also run LLM-as-judge faithfulness (needs ANTHROPIC_API_KEY)
//          --out FILE        write JSON results (default results/<timestamp>.json)
//          --embedding SPACE 'openai' or 'voyage' — forces which embedding
//                            space rag-answer uses for this run. Omit to use
//                            whatever the account's saved AI Settings
//                            preference is (defaults to 'openai' server-side
//                            if nothing was ever saved there).
//
// To compare embedding spaces, run twice with different --out files:
//   node run-eval.mjs --embedding openai --out results/openai.json
//   node run-eval.mjs --embedding voyage --out results/voyage.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { getSupabase, askRag, getConfig } from './lib/client.mjs';
import {
  precisionAtK, recallAtK, reciprocalRank, ndcgAtK, hitAtK,
  mean, pct, citationValidity, isRefusal,
} from './lib/metrics.mjs';

const args = process.argv.slice(2);
const argVal = (f, d) => { const i = args.indexOf(f); return i === -1 ? d : args[i + 1]; };
const SET = argVal('--set', 'golden-set.json');
const K = Number(argVal('--k', 10));
const JUDGE = args.includes('--judge');
const OUT = argVal('--out', `results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const EMBEDDING = argVal('--embedding', null);
if (EMBEDDING && !['openai', 'voyage'].includes(EMBEDDING)) {
  throw new Error(`--embedding must be 'openai' or 'voyage', got '${EMBEDDING}'`);
}

const MODEL = 'claude-opus-5';

async function judgeFaithfulness(anthropic, question, answer, excerpts) {
  const context = excerpts
    .map((e) => `[${e.ref}] ${e.title}\n${e.content}`)
    .join('\n\n---\n\n');
  const prompt = `You are grading a retrieval-augmented answer for FAITHFULNESS only.

Question: ${question}

Excerpts the model was given:
${context}

Answer produced:
${answer}

Score 1-5:
5 = every claim is directly supported by the excerpts
4 = supported, with minor unsupported phrasing
3 = mostly supported, one unsupported claim
2 = several unsupported claims
1 = largely fabricated or contradicts the excerpts

Judge ONLY whether claims are grounded in the excerpts. Do not reward or
penalise style, completeness, or whether you personally know the answer.

Return ONLY JSON: {"score": N, "unsupportedClaims": ["..."]}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

async function main() {
  const golden = JSON.parse(readFileSync(SET, 'utf8'));
  const unreviewed = golden.cases.filter((c) => c.reviewed === false).length;
  if (unreviewed) {
    console.warn(`⚠️  ${unreviewed} case(s) are still marked reviewed:false — metrics may reflect question quality, not pipeline quality.\n`);
  }

  const { supabase, email } = await getSupabase();
  console.log(`Signed in as ${email}. Running ${golden.cases.length} cases (k=${K})...`);
  console.log(`Embedding space: ${EMBEDDING ? `${EMBEDDING} (forced via --embedding)` : "account's saved AI Settings preference (defaults to 'openai' if never set)"}\n`);

  let anthropic = null;
  if (JUDGE) {
    const apiKey = getConfig().ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('--judge requires ANTHROPIC_API_KEY (add it to evals/.env.local)');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey });
  }

  const results = [];
  for (const c of golden.cases) {
    const started = Date.now();
    const res = await askRag(supabase, c.question, {
      history: c.history ?? [],
      ...(EMBEDDING ? { embeddingProvider: EMBEDDING } : {}),
    });
    const latencyMs = Date.now() - started;

    if (res?.error) {
      results.push({ ...c, error: res.error, latencyMs });
      process.stdout.write('E');
      continue;
    }

    const candidates = res.retrieval?.candidates ?? [];
    const excerpts = res.excerpts ?? [];
    const answer = res.summary ?? '';

    // Binary relevance in rank order, judged at document level.
    const relevance = candidates.map((cand) => c.expectedDocs.includes(cand.title));
    const foundDocs = candidates.slice(0, K).filter((x) => x.title).map((x) => x.title);

    const record = {
      id: c.id,
      type: c.type,
      question: c.question,
      latencyMs,
      refused: isRefusal(answer),
      answerChars: answer.length,
      excerptCount: excerpts.length,
      citations: citationValidity(answer, excerpts.length),
      retrieval: {
        candidateCount: candidates.length,
        // What rag-answer ACTUALLY used this call, per its own response —
        // never inferred or assumed. embeddingFallback is set when 'voyage'
        // was requested but the account has no Voyage-embedded index yet (or
        // no VOYAGE_API_KEY), in which case the server silently used openai.
        embeddingSpace: res.retrieval?.embeddingSpace ?? null,
        embeddingModel: res.retrieval?.embeddingModel ?? null,
        embeddingFallback: res.retrieval?.embeddingFallback ?? null,
        keywordQueries: res.retrieval?.keywordQueries ?? null,
        retrievalQuery: res.retrieval?.retrievalQuery ?? null,
        reranked: res.retrieval?.reranked ?? false,
        // Share of candidates the keyword channel actually matched — the
        // diagnostic for "is hybrid search really hybrid?"
        keywordCoverage: candidates.length
          ? candidates.filter((x) => x.keywordRank != null).length / candidates.length
          : 0,
      },
    };

    if (c.type === 'answerable') {
      record.metrics = {
        precisionAtK: precisionAtK(relevance, K),
        recallAtK: recallAtK(foundDocs, c.expectedDocs),
        mrr: reciprocalRank(relevance),
        ndcgAtK: ndcgAtK(relevance, K),
        hitAtK: hitAtK(relevance, K),
      };
      record.factsPresent = (c.expectedFacts ?? []).map((f) => ({
        fact: f,
        present: answer.toLowerCase().includes(String(f).toLowerCase()),
      }));
      if (anthropic && !record.refused && excerpts.length) {
        try {
          record.faithfulness = await judgeFaithfulness(anthropic, c.question, answer, excerpts);
        } catch (e) {
          record.faithfulness = { error: e.message };
        }
      }
    }

    results.push(record);
    process.stdout.write(record.refused ? 'r' : '.');
  }

  console.log('\n');

  const answerable = results.filter((r) => r.type === 'answerable' && !r.error);
  const guard = results.filter((r) => r.type !== 'answerable' && !r.error);
  const errored = results.filter((r) => r.error);

  // Distinct embedding spaces actually reported by rag-answer across all
  // calls. Should be exactly one value — if it's more, settings changed
  // mid-run (e.g. someone edited AI Settings while this was running).
  const embeddingSpacesSeen = [...new Set(results.map((r) => r.retrieval?.embeddingSpace).filter(Boolean))];
  const embeddingFallbacks = results.filter((r) => r.retrieval?.embeddingFallback);

  const summary = {
    ranAt: new Date().toISOString(),
    account: email,
    k: K,
    embeddingSpacesSeen,
    embeddingFallbackCount: embeddingFallbacks.length,
    caseCounts: { answerable: answerable.length, guardrail: guard.length, errored: errored.length },
    retrieval: {
      precisionAtK: mean(answerable.map((r) => r.metrics?.precisionAtK)),
      recallAtK: mean(answerable.map((r) => r.metrics?.recallAtK)),
      mrr: mean(answerable.map((r) => r.metrics?.mrr)),
      ndcgAtK: mean(answerable.map((r) => r.metrics?.ndcgAtK)),
      hitRateAtK: answerable.length ? answerable.filter((r) => r.metrics?.hitAtK).length / answerable.length : 0,
      keywordCoverage: mean(results.map((r) => r.retrieval?.keywordCoverage)),
      rerankedShare: results.length ? results.filter((r) => r.retrieval?.reranked).length / results.length : 0,
    },
    answerQuality: {
      // A refusal on an ANSWERABLE question is a false refusal: retrieval or
      // the min-similarity floor failed, not the user.
      falseRefusalRate: answerable.length ? answerable.filter((r) => r.refused).length / answerable.length : 0,
      expectedFactRecall: mean(
        answerable.flatMap((r) => (r.factsPresent ?? []).map((f) => (f.present ? 1 : 0)))
      ),
      invalidCitationRate: (() => {
        const withCites = answerable.filter((r) => r.citations?.anyCitation);
        return withCites.length ? withCites.filter((r) => r.citations.invalid.length > 0).length / withCites.length : 0;
      })(),
      uncitedAnswerRate: answerable.length
        ? answerable.filter((r) => !r.refused && !r.citations?.anyCitation).length / answerable.length : 0,
      faithfulnessMean: JUDGE ? mean(answerable.map((r) => r.faithfulness?.score)) : null,
    },
    guardrails: {
      // A NON-refusal on an unanswerable question is a hallucination risk —
      // the single most important safety number in this whole report.
      falseAnswerRate: guard.length ? guard.filter((r) => !r.refused).length / guard.length : 0,
      byType: Object.fromEntries(
        [...new Set(guard.map((r) => r.type))].map((t) => {
          const g = guard.filter((r) => r.type === t);
          return [t, { n: g.length, refused: g.filter((r) => r.refused).length }];
        })
      ),
    },
    latency: {
      meanMs: Math.round(mean(results.map((r) => r.latencyMs))),
      p95Ms: (() => {
        const s = results.map((r) => r.latencyMs).filter(Boolean).sort((a, b) => a - b);
        return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0;
      })(),
    },
  };

  mkdirSync('results', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2));

  const R = summary.retrieval, A = summary.answerQuality, G = summary.guardrails;
  console.log(`════════ EMBEDDING SPACE: ${embeddingSpacesSeen.join(', ') || 'unknown'} ════════`);
  if (embeddingSpacesSeen.length > 1) {
    console.log('  ⚠️  More than one embedding space appeared across this run — results are not comparable to');
    console.log('      a single-space baseline. Did AI Settings change mid-run?');
  }
  if (embeddingFallbacks.length > 0) {
    console.log(`  ⚠️  ${embeddingFallbacks.length} case(s) requested 'voyage' but fell back to 'openai':`);
    console.log(`      "${embeddingFallbacks[0].retrieval.embeddingFallback}"`);
  }
  console.log('\n════════ RETRIEVAL ════════');
  console.log(`  Hit@${K}          ${pct(R.hitRateAtK)}   (at least one correct doc retrieved)`);
  console.log(`  Recall@${K}       ${pct(R.recallAtK)}   (share of expected docs found)`);
  console.log(`  Precision@${K}    ${pct(R.precisionAtK)}   (share of retrieved that were relevant)`);
  console.log(`  MRR             ${R.mrr.toFixed(3)}   (1.0 = correct doc always ranked first)`);
  console.log(`  NDCG@${K}         ${R.ndcgAtK.toFixed(3)}`);
  console.log(`  Keyword coverage ${pct(R.keywordCoverage)}  (candidates the keyword channel matched)`);
  console.log(`  Reranked         ${pct(R.rerankedShare)}  (queries where Voyage ran)`);
  console.log('\n════════ ANSWER QUALITY ════════');
  console.log(`  False refusal   ${pct(A.falseRefusalRate)}   (said "not in documents" when it was)`);
  console.log(`  Expected facts  ${pct(A.expectedFactRecall)}   (required strings present in answer)`);
  console.log(`  Invalid cites   ${pct(A.invalidCitationRate)}   (cited [n] with no such excerpt)`);
  console.log(`  Uncited answers ${pct(A.uncitedAnswerRate)}`);
  if (JUDGE) console.log(`  Faithfulness    ${A.faithfulnessMean?.toFixed(2)} / 5`);
  console.log('\n════════ GUARDRAILS ════════');
  console.log(`  False answer    ${pct(G.falseAnswerRate)}   (answered when it should have refused)`);
  for (const [t, v] of Object.entries(G.byType)) console.log(`    ${t.padEnd(14)} ${v.refused}/${v.n} refused`);
  console.log('\n════════ LATENCY ════════');
  console.log(`  mean ${summary.latency.meanMs}ms   p95 ${summary.latency.p95Ms}ms`);
  if (errored.length) console.log(`\n⚠️  ${errored.length} case(s) errored — see ${OUT}`);
  console.log(`\nFull results: ${OUT}`);
}

main().catch((e) => { console.error(`\n${e.message}`); process.exit(1); });
