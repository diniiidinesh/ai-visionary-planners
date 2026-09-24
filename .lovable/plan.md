# Match the Embedding A/B Lab to Live run

## Goal
Rebuild the Embedding A/B Lab’s results area so each model follows the same clear, expandable stage-by-stage presentation used by Live run, while preserving the existing conversational comparison behavior.

## Changes
- Keep the current shared question input, follow-up history, loading state, and “New conversation” action.
- Replace each model’s generic result accordion with the same nine retrieval stages used in Live run: question, rewritten query, query embedding, semantic search, keyword search, RRF fusion, reranking, prompt excerpts, and generated answer.
- Present OpenAI and Voyage in aligned side-by-side columns on larger screens and stacked columns on smaller screens, retaining model, timing, reranking, fallback, and retrieval-agreement indicators.
- Reuse the Live run stage status visuals and candidate-table hierarchy so both tools feel like one coherent pipeline experience.
- Preserve the lab’s forced `lookup` behavior because corpus-overview requests skip embeddings and cannot provide a meaningful A/B comparison.

## Validation
- Confirm the pipeline page builds without errors.
- Check the A/B lab at desktop and mobile widths for readable controls, aligned comparisons, and no overlapping content.
- Verify an authenticated comparison still carries separate conversation history for both embedding spaces.
