// Query planning: turns a (possibly conversational) question into the two
// query shapes the retrieval channels actually want.
//
// The vector channel wants a full natural-language sentence — more tokens means
// more semantic signal in the embedding. The keyword channel wants 2-4 sharp
// terms, because `websearch_to_tsquery` ANDs every term: feed it a whole
// question and a chunk must contain every word to match, so nothing does.
//
// Both come from ONE model call so a follow-up costs one round trip, not two.
import { AIProvider } from '../ai/base-provider.ts';

/**
 * Which answering path a question needs.
 *
 *   'lookup'          -> find specific passages and answer from them (the default,
 *                        and what the retrieval pipeline is built for).
 *   'corpus_overview' -> describe the collection itself (how many documents, what
 *                        kinds, from where). Top-k passage retrieval structurally
 *                        cannot answer these: the passage cap means the model sees
 *                        a handful of documents and describes them as if they were
 *                        the whole corpus. Answered from the catalog instead.
 */
export type QueryIntent = 'lookup' | 'corpus_overview';

const INTENTS: QueryIntent[] = ['lookup', 'corpus_overview'];

export interface QueryPlan {
  /** Self-contained question, with conversational references resolved. Embedded for the vector channel. */
  standaloneQuestion: string;
  /** Short keyword queries (2-4 terms each) for the full-text channel. */
  keywordQueries: string[];
  /** Which answering path this question needs. Anything uncertain resolves to 'lookup'. */
  intent: QueryIntent;
  /** True when the model actually produced a plan (false = fell back to the raw question). */
  planned: boolean;
}

const MAX_KEYWORD_QUERIES = 4;

function fallback(question: string): QueryPlan {
  return { standaloneQuestion: question, keywordQueries: [question], intent: 'lookup', planned: false };
}

/**
 * Plans retrieval queries for `question`. `history` (oldest first) is used only
 * to resolve references like "that one" / "the other". Never throws — any
 * failure degrades to using the raw question for both channels.
 */
export async function planQuery(
  provider: AIProvider,
  question: string,
  history: { role: string; content: string }[] = []
): Promise<QueryPlan> {
  const transcript = history.length
    ? `Conversation so far:\n${history.map((h) => `${h.role}: ${h.content}`).join('\n')}\n\n`
    : '';

  const prompt = `${transcript}Question: "${question}"

You are preparing this question for a document search engine with two channels:
a semantic (embedding) channel and a literal keyword (full-text) channel.

Return a JSON object with:
- "standaloneQuestion": the question rewritten so it makes sense with no prior
  context. Resolve every pronoun and reference using the conversation above.
  Keep the original intent exactly. If the question is already standalone,
  return it unchanged.
- "keywordQueries": 2-4 SHORT keyword searches (2-4 words each, no filler words,
  no punctuation) targeting distinct facets of the question. These are matched
  literally against document text, so use terms likely to appear verbatim in the
  documents — proper nouns, product names, metrics, section titles. Do NOT write
  full sentences here.
- "intent": either "lookup" or "corpus_overview".
    "corpus_overview" = the question is about the COLLECTION ITSELF — how many
      documents there are, what kinds of files, what folders they came from, what
      is or isn't indexed, when things were last updated, or a general "what do
      you have access to".
    "lookup" = the question is about what the documents SAY. This is the default.
      Use it whenever there is any doubt.
  The distinction is about the subject of the question, not its wording. A
  question naming a specific document is a lookup even if it says "contains":
    "What does my Drive contain?"                      -> corpus_overview
    "How many documents do you have indexed?"          -> corpus_overview
    "What kinds of files are in here?"                 -> corpus_overview
    "What does the Dashverse document contain?"        -> lookup
    "Which documents mention pricing?"                 -> lookup
    "Summarise the hiring plan"                        -> lookup

Example:
{
  "standaloneQuestion": "What pricing tiers were proposed for Glean for PMs?",
  "keywordQueries": ["Glean PM pricing", "pricing tiers", "monthly subscription cost"],
  "intent": "lookup"
}

Return ONLY valid JSON, no other text.`;

  try {
    const response = await provider.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      maxTokens: 400,
      responseFormat: 'json',
    });
    if (!response.content) return fallback(question);

    const parsed = provider.parseJSONResponse(response.content);

    const standaloneQuestion =
      typeof parsed?.standaloneQuestion === 'string' && parsed.standaloneQuestion.trim()
        ? parsed.standaloneQuestion.trim()
        : question;

    const keywordQueries = Array.isArray(parsed?.keywordQueries)
      ? parsed.keywordQueries
          .filter((q: unknown): q is string => typeof q === 'string' && q.trim().length > 0)
          .map((q: string) => q.trim())
          .slice(0, MAX_KEYWORD_QUERIES)
      : [];

    // Anything the model didn't return as a known intent is treated as a lookup:
    // misrouting a lookup to the catalog gives a confidently wrong answer, while
    // misrouting an overview to retrieval just reproduces today's behaviour.
    const intent: QueryIntent = INTENTS.includes(parsed?.intent) ? parsed.intent : 'lookup';

    // A plan with no usable keyword queries is worse than none — fall back to
    // the standalone question so the keyword channel still gets something.
    if (keywordQueries.length === 0) {
      return { standaloneQuestion, keywordQueries: [standaloneQuestion], intent, planned: true };
    }

    return { standaloneQuestion, keywordQueries, intent, planned: true };
  } catch (err) {
    console.error('Query planning failed, using raw question:', err);
    return fallback(question);
  }
}
