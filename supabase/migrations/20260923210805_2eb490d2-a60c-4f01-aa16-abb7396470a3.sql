CREATE TABLE public.demo_usage (
  day date PRIMARY KEY,
  questions integer NOT NULL DEFAULT 0
);
GRANT ALL ON public.demo_usage TO service_role;
ALTER TABLE public.demo_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.demo_consume_question(p_limit integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used integer;
BEGIN
  INSERT INTO public.demo_usage(day, questions) VALUES (current_date, 1)
  ON CONFLICT (day) DO UPDATE SET questions = demo_usage.questions + 1
  WHERE demo_usage.questions < p_limit
  RETURNING questions INTO used;
  RETURN used; -- NULL when limit already reached
END $$;
REVOKE ALL ON FUNCTION public.demo_consume_question(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_consume_question(integer) TO service_role;