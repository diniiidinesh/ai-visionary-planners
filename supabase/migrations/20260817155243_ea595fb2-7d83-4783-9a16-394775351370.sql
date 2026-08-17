ALTER TABLE public.user_ai_preferences
  ADD COLUMN IF NOT EXISTS auto_sync_daily boolean NOT NULL DEFAULT false;