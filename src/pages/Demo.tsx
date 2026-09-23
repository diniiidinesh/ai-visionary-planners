import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Loader2, Layers, MessageSquare, GitCompare } from "lucide-react";
import { DEMO_DAILY_LIMIT, setDemoMode } from "@/lib/demo";

const Demo = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const start = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("demo-login", { body: {} });
      if (error || !data?.access_token) throw new Error(data?.error || "Demo is not available right now.");
      const { error: sessErr } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessErr) throw sessErr;
      setDemoMode(true);
      navigate("/pipeline");
    } catch (e: any) {
      toast({ title: "Couldn't start the demo", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const points = [
    { icon: Layers, text: "See how documents become searchable passages, step by step." },
    { icon: MessageSquare, text: "Ask a question and watch each stage of the answer happen live." },
    { icon: GitCompare, text: "Compare two embedding models side by side on the same question." },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/30 px-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Try the live demo</CardTitle>
          <CardDescription>
            Explore the full end-to-end workflow on a real, indexed Google Drive. No sign-up needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ul className="space-y-3">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 text-sm">
                <Icon className="h-5 w-5 shrink-0 text-accent" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
          <Button size="lg" className="w-full" onClick={start} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {loading ? "Opening demo..." : "Try the demo"}
            {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            The demo is shared: up to {DEMO_DAILY_LIMIT} questions per day across all visitors.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Demo;
