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
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";

interface AIPreferences {
  searchProvider: string;
  searchModel: string;
  searchOrgId?: string;
  summarizeProvider: string;
  summarizeModel: string;
  summarizeOrgId?: string;
  enableCostTracking: boolean;
  monthlyBudgetUsd?: number;
}

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
  const [preferences, setPreferences] = useState<AIPreferences>({
    searchProvider: 'lovable',
    searchModel: 'google/gemini-2.5-flash',
    summarizeProvider: 'lovable',
    summarizeModel: 'google/gemini-2.5-flash',
    enableCostTracking: false,
  });

  useEffect(() => {
    loadPreferences();
  }, []);

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
          onClick={() => navigate('/')}
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
