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

/** Parses KEY=VALUE pairs out of a dotenv-style file. Missing file -> {}. */
function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Config resolution, lowest priority first:
 *   1. repo .env            — Supabase URL + anon key (shared with the app)
 *   2. evals/.env.local     — your eval credentials (gitignored)
 *   3. real environment     — wins, for CI or one-off overrides
 *
 * .env.local exists so credentials never have to be typed at a shell prompt.
 * That avoids per-shell syntax differences, and keeps your password out of
 * PowerShell/bash history files, which are stored on disk in plain text.
 */
function loadConfig() {
  return {
    ...parseEnvFile(join(repoRoot, '.env')),
    ...parseEnvFile(join(here, '..', '.env.local')),
    ...process.env,
  };
}

/** Config for non-Supabase consumers (e.g. the Anthropic key in the generator). */
export function getConfig() {
  return loadConfig();
}

export async function getSupabase() {
  const env = loadConfig();
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (checked repo .env, evals/.env.local, and the environment).');
  }

  const supabase = createClient(url, anonKey);

  const email = env.EVAL_EMAIL;
  const password = env.EVAL_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Missing EVAL_EMAIL / EVAL_PASSWORD.\n\n' +
      'Easiest fix — create evals/.env.local (gitignored) containing:\n' +
      '  EVAL_EMAIL=you@example.com\n' +
      '  EVAL_PASSWORD=your-password\n' +
      '  ANTHROPIC_API_KEY=sk-ant-...   # only needed for generate-golden-set\n\n' +
      'Then just run:  node run-eval.mjs'
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
