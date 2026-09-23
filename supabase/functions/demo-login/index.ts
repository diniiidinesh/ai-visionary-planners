// One-click demo sign-in. The password lives only in the DEMO_PASSWORD secret,
// never in the browser bundle.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const DEMO_EMAIL = "bd20025@astra.xlri.ac.in";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const password = Deno.env.get("DEMO_PASSWORD");
    if (!password) {
      console.error("demo-login: DEMO_PASSWORD not configured");
      return json({ error: "Demo is not available right now." }, 503);
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const { data, error } = await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password });
    if (error || !data.session) {
      console.error("demo-login sign-in failed:", error?.message);
      return json({ error: "Demo is not available right now." }, 503);
    }
    return json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (e) {
    console.error("demo-login error:", e);
    return json({ error: "Demo is not available right now." }, 500);
  }
});
