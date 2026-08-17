import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { ArrowLeft, Save, Info, RotateCcw } from "lucide-react";

interface AIPreferences {
  searchProvider: string;
  searchModel: string;
  searchOrgId?: string;
  summarizeProvider: string;
  summarizeModel: string;
  summarizeOrgId?: string;
  enableCostTracking: boolean;
  monthlyBudgetUsd?: number;
  temperature: number;
  maxOutputTokens: number;
  retrievalTopK: number;
  passagesToModel: number;
  minSimilarity: number;
  maxPassagesPerDoc: number;
  retrievalMode: 'vector' | 'hybrid' | 'keyword';
  debugRetrieval: boolean;
}

const TUNING_DEFAULTS = {
  temperature: 0.3,
  maxOutputTokens: 2000,
  retrievalTopK: 20,
  passagesToModel: 10,
  minSimilarity: 0.15,
  maxPassagesPerDoc: 3,
  retrievalMode: 'hybrid' as const,
  debugRetrieval: false,
};

type ProviderStatus = Record<string, { project: boolean; personal: boolean; configured: boolean }>;

const PROVIDERS = [
  { value: 'lovable', label: 'Lovable AI' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google Gemini' },
];

const PROVIDER_MODELS: Record<string, string[]> = {
  lovable: [
    'google/gemini-2.5-flash',
    'google/gemini-2.5-pro',
    'google/gemini-2.5-flash-lite',
    'openai/gpt-5-mini',
    'openai/gpt-5',
  ],
  openai: ['gpt-5-mini', 'gpt-5', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o'],
  google: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'],
};

export default function AISettings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({});
  const [preferences, setPreferences] = useState<AIPreferences>({
    searchProvider: 'lovable',
    searchModel: 'google/gemini-2.5-flash',
    summarizeProvider: 'lovable',
    summarizeModel: 'google/gemini-2.5-flash',
    enableCostTracking: false,
    ...TUNING_DEFAULTS,
  });

  useEffect(() => {
    loadPreferences();
    loadProviderStatus();
  }, []);

  const loadProviderStatus = async () => {
    const { data, error } = await supabase.functions.invoke('ai-provider-status');
    if (error) {
      console.error('Error loading provider status:', error);
      return;
    }
    setProviderStatus(data?.providers ?? {});
  };

  const providerLabel = (value: string) =>
    PROVIDERS.find((p) => p.value === value)?.label ?? value;

  const ActiveProvider = ({ provider, model }: { provider: string; model: string }) => {
    const status = providerStatus[provider];
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">Currently in effect:</span>
        <span className="font-medium">{providerLabel(provider)}</span>
        <span className="text-muted-foreground">/</span>
        <span className="font-mono text-xs">{model}</span>
        {status && (
          <Badge variant={status.configured ? 'secondary' : 'destructive'}>
            {status.configured
              ? status.personal
                ? 'Your key configured'
                : 'Project key configured'
              : 'No key configured'}
          </Badge>
        )}
      </div>
    );
  };

  const loadPreferences = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/auth');
        return;
      }

      const { data, error } = await supabase
        .from('user_ai_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setPreferences({
          searchProvider: data.search_provider || 'lovable',
          searchModel: data.search_model || 'google/gemini-2.5-flash',
          searchOrgId: data.search_org_id || '',
          summarizeProvider: data.summarize_provider || 'lovable',
          summarizeModel: data.summarize_model || 'google/gemini-2.5-flash',
          summarizeOrgId: data.summarize_org_id || '',
          enableCostTracking: data.enable_cost_tracking || false,
          monthlyBudgetUsd: data.monthly_budget_usd || undefined,
          temperature: Number(data.temperature ?? TUNING_DEFAULTS.temperature),
          maxOutputTokens: data.max_output_tokens ?? TUNING_DEFAULTS.maxOutputTokens,
          retrievalTopK: data.retrieval_top_k ?? TUNING_DEFAULTS.retrievalTopK,
          passagesToModel: data.passages_to_model ?? TUNING_DEFAULTS.passagesToModel,
          minSimilarity: Number(data.min_similarity ?? TUNING_DEFAULTS.minSimilarity),
          maxPassagesPerDoc: data.max_passages_per_doc ?? TUNING_DEFAULTS.maxPassagesPerDoc,
          retrievalMode: (data.retrieval_mode as AIPreferences['retrievalMode']) || TUNING_DEFAULTS.retrievalMode,
          debugRetrieval: data.debug_retrieval ?? TUNING_DEFAULTS.debugRetrieval,
        });
      }
    } catch (error: any) {
      console.error('Error loading preferences:', error);
      toast.error('Failed to load AI preferences');
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke('update-ai-preferences', {
        body: {
          searchProvider: preferences.searchProvider,
          searchModel: preferences.searchModel,
          searchOrgId: preferences.searchOrgId || null,
          summarizeProvider: preferences.summarizeProvider,
          summarizeModel: preferences.summarizeModel,
          summarizeOrgId: preferences.summarizeOrgId || null,
          enableCostTracking: preferences.enableCostTracking,
          monthlyBudgetUsd: preferences.monthlyBudgetUsd || null,
          temperature: preferences.temperature,
          maxOutputTokens: preferences.maxOutputTokens,
          retrievalTopK: preferences.retrievalTopK,
          passagesToModel: preferences.passagesToModel,
          minSimilarity: preferences.minSimilarity,
          maxPassagesPerDoc: preferences.maxPassagesPerDoc,
          retrievalMode: preferences.retrievalMode,
          debugRetrieval: preferences.debugRetrieval,
        },
      });

      if (error) throw error;

      toast.success('AI preferences saved successfully');
    } catch (error: any) {
      console.error('Error saving preferences:', error);
      toast.error('Failed to save AI preferences');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto py-8 px-4">
        <Button
          variant="ghost"
          onClick={() => navigate('/search')}
          className="mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold">AI Settings</h1>
            <p className="text-muted-foreground mt-2">
              Configure your AI providers and preferences for search and summarization
            </p>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              API keys are managed centrally at the project level, so there is nothing to paste here.
              Pick the provider and model you want and the app uses the matching key automatically.
              Document indexing (embeddings) always uses the built-in AI provider.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>Search Provider</CardTitle>
              <CardDescription>
                Choose which AI provider to use for query processing and search optimization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="search-provider">Provider</Label>
                <Select
                  value={preferences.searchProvider}
                  onValueChange={(value) =>
                    setPreferences({
                      ...preferences,
                      searchProvider: value,
                      searchModel: PROVIDER_MODELS[value][0],
                    })
                  }
                >
                  <SelectTrigger id="search-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="search-model">Model</Label>
                <Select
                  value={preferences.searchModel}
                  onValueChange={(value) =>
                    setPreferences({ ...preferences, searchModel: value })
                  }
                >
                  <SelectTrigger id="search-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_MODELS[preferences.searchProvider]?.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {preferences.searchProvider === 'openai' && (
                <div className="space-y-2">
                  <Label htmlFor="search-org-id">Organization ID (Optional)</Label>
                  <Input
                    id="search-org-id"
                    value={preferences.searchOrgId || ''}
                    onChange={(e) =>
                      setPreferences({ ...preferences, searchOrgId: e.target.value })
                    }
                    placeholder="org-..."
                  />
                </div>
              )}

              <ActiveProvider
                provider={preferences.searchProvider}
                model={preferences.searchModel}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Summarization Provider</CardTitle>
              <CardDescription>
                Choose which AI provider to use for content summarization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="summarize-provider">Provider</Label>
                <Select
                  value={preferences.summarizeProvider}
                  onValueChange={(value) =>
                    setPreferences({
                      ...preferences,
                      summarizeProvider: value,
                      summarizeModel: PROVIDER_MODELS[value][0],
                    })
                  }
                >
                  <SelectTrigger id="summarize-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="summarize-model">Model</Label>
                <Select
                  value={preferences.summarizeModel}
                  onValueChange={(value) =>
                    setPreferences({ ...preferences, summarizeModel: value })
                  }
                >
                  <SelectTrigger id="summarize-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_MODELS[preferences.summarizeProvider]?.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {preferences.summarizeProvider === 'openai' && (
                <div className="space-y-2">
                  <Label htmlFor="summarize-org-id">Organization ID (Optional)</Label>
                  <Input
                    id="summarize-org-id"
                    value={preferences.summarizeOrgId || ''}
                    onChange={(e) =>
                      setPreferences({ ...preferences, summarizeOrgId: e.target.value })
                    }
                    placeholder="org-..."
                  />
                </div>
              )}

              <ActiveProvider
                provider={preferences.summarizeProvider}
                model={preferences.summarizeModel}
              />
            </CardContent>
          </Card>


          <Card>
            <CardHeader>
              <CardTitle>Cost Tracking</CardTitle>
              <CardDescription>
                Monitor AI usage and set monthly budget limits
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="cost-tracking">Enable Cost Tracking</Label>
                  <p className="text-sm text-muted-foreground">
                    Track AI costs and log usage statistics
                  </p>
                </div>
                <Switch
                  id="cost-tracking"
                  checked={preferences.enableCostTracking}
                  onCheckedChange={(checked) =>
                    setPreferences({ ...preferences, enableCostTracking: checked })
                  }
                />
              </div>

              {preferences.enableCostTracking && (
                <div className="space-y-2">
                  <Label htmlFor="budget">Monthly Budget (USD)</Label>
                  <Input
                    id="budget"
                    type="number"
                    min="0"
                    step="0.01"
                    value={preferences.monthlyBudgetUsd || ''}
                    onChange={(e) =>
                      setPreferences({
                        ...preferences,
                        monthlyBudgetUsd: parseFloat(e.target.value) || undefined,
                      })
                    }
                    placeholder="100.00"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Retrieval &amp; Generation</CardTitle>
                  <CardDescription>
                    Tune how passages are found and how the answer is written. Changes apply to the next
                    question you ask — no re-indexing needed.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreferences({ ...preferences, ...TUNING_DEFAULTS })}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Retrieval mode</Label>
                <Select
                  value={preferences.retrievalMode}
                  onValueChange={(value) =>
                    setPreferences({ ...preferences, retrievalMode: value as AIPreferences['retrievalMode'] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hybrid">Hybrid (meaning + keywords)</SelectItem>
                    <SelectItem value="vector">Meaning only (vector)</SelectItem>
                    <SelectItem value="keyword">Keywords only</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Hybrid finds paraphrases and exact terms (IDs, error codes, product names) and merges
                  both ranked lists. Keyword-only skips the embedding call entirely.
                </p>
              </div>

              <TuningSlider
                id="temperature"
                label="Temperature"
                hint="0 keeps answers literal and repeatable; higher values allow looser phrasing."
                value={preferences.temperature}
                min={0}
                max={1}
                step={0.05}
                format={(v) => v.toFixed(2)}
                onChange={(v) => setPreferences({ ...preferences, temperature: v })}
              />

              <TuningSlider
                id="max-output-tokens"
                label="Max answer length (tokens)"
                hint="Upper bound on the generated answer. Roughly 1 token ≈ 4 characters."
                value={preferences.maxOutputTokens}
                min={256}
                max={8000}
                step={128}
                format={(v) => String(v)}
                onChange={(v) => setPreferences({ ...preferences, maxOutputTokens: v })}
              />

              <TuningSlider
                id="retrieval-top-k"
                label="Candidates retrieved"
                hint="How many passages the search stage considers before filtering. Higher = better recall, slower."
                value={preferences.retrievalTopK}
                min={5}
                max={40}
                step={1}
                format={(v) => String(v)}
                onChange={(v) => setPreferences({ ...preferences, retrievalTopK: v })}
              />

              <TuningSlider
                id="passages-to-model"
                label="Passages sent to the model"
                hint="More context can help, but too much dilutes the answer and costs more."
                value={preferences.passagesToModel}
                min={1}
                max={15}
                step={1}
                format={(v) => String(v)}
                onChange={(v) => setPreferences({ ...preferences, passagesToModel: v })}
              />

              <TuningSlider
                id="min-similarity"
                label="Minimum relevance"
                hint="Passages below this similarity are discarded. Raise it if answers cite irrelevant text."
                value={preferences.minSimilarity}
                min={0}
                max={0.5}
                step={0.01}
                format={(v) => v.toFixed(2)}
                onChange={(v) => setPreferences({ ...preferences, minSimilarity: v })}
              />

              <TuningSlider
                id="max-per-doc"
                label="Max passages per document"
                hint="Stops one long document from crowding out every other source."
                value={preferences.maxPassagesPerDoc}
                min={1}
                max={5}
                step={1}
                format={(v) => String(v)}
                onChange={(v) => setPreferences({ ...preferences, maxPassagesPerDoc: v })}
              />

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="debug-retrieval">Show retrieval debug</Label>
                  <p className="text-sm text-muted-foreground">
                    Lists every candidate passage with its scores and whether it made the cut.
                  </p>
                </div>
                <Switch
                  id="debug-retrieval"
                  checked={preferences.debugRetrieval}
                  onCheckedChange={(checked) =>
                    setPreferences({ ...preferences, debugRetrieval: checked })
                  }
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={savePreferences} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save All Settings'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
