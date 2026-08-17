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

export interface QueryPlan {
  /** Self-contained question, with conversational references resolved. Embedded for the vector channel. */
  standaloneQuestion: string;
  /** Short keyword queries (2-4 terms each) for the full-text channel. */
  keywordQueries: string[];
  /** True when the model actually produced a plan (false = fell back to the raw question). */
  planned: boolean;
}

const MAX_KEYWORD_QUERIES = 4;

function fallback(question: string): QueryPlan {
  return { standaloneQuestion: question, keywordQueries: [question], planned: false };
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

Example:
{
  "standaloneQuestion": "What pricing tiers were proposed for Glean for PMs?",
  "keywordQueries": ["Glean PM pricing", "pricing tiers", "monthly subscription cost"]
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

    // A plan with no usable keyword queries is worse than none — fall back to
    // the standalone question so the keyword channel still gets something.
    if (keywordQueries.length === 0) {
      return { standaloneQuestion, keywordQueries: [standaloneQuestion], planned: true };
    }

    return { standaloneQuestion, keywordQueries, planned: true };
  } catch (err) {
    console.error('Query planning failed, using raw question:', err);
    return fallback(question);
  }
}
