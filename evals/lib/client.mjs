// Shared auth + config for the eval scripts.
//
// The eval runs as YOU: `document_chunks` is RLS-scoped to auth.uid(), so the
// harness signs in with your account and sees exactly the corpus your app sees.
// No service-role key is used or needed.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

/** Reads KEY=VALUE pairs out of the app's .env so we don't duplicate config. */
function loadDotEnv() {
  const path = join(repoRoot, '.env');
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export async function getSupabase() {
  const env = { ...loadDotEnv(), ...process.env };
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (checked .env and process env).');
  }

  const supabase = createClient(url, anonKey);

  const email = process.env.EVAL_EMAIL;
  const password = process.env.EVAL_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Set EVAL_EMAIL and EVAL_PASSWORD to the account whose indexed corpus you want to evaluate.\n' +
      'Example: EVAL_EMAIL=you@example.com EVAL_PASSWORD=... npm run eval'
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed: ${error.message}`);
  return { supabase, userId: data.user.id, email };
}

/** Calls the deployed rag-answer edge function with debug retrieval forced on. */
export async function askRag(supabase, question, { history = [], topK } = {}) {
  const body = {
    question,
    history,
    overrides: { debugRetrieval: true, ...(topK ? { retrievalTopK: topK } : {}) },
  };
  const { data, error } = await supabase.functions.invoke('rag-answer', { body });
  if (error) return { error: error.message ?? String(error) };
  return data;
}
