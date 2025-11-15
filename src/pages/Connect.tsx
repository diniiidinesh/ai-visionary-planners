import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Circle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";

const Connect = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [connections, setConnections] = useState<{ [key: string]: boolean }>({});
  const [loading, setLoading] = useState(false);

  const integrations = [
    {
      name: "Notion",
      logo: "https://upload.wikimedia.org/wikipedia/commons/4/45/Notion_app_logo.png",
      connected: connections['notion'] || false,
    },
    {
      name: "Slack",
      logo: "https://upload.wikimedia.org/wikipedia/commons/b/b9/Slack_Technologies_Logo.svg",
      connected: connections['slack'] || false,
    },
    {
      name: "Google Drive",
      logo: "https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg",
      connected: connections['google_drive'] || false,
    },
  ];

  useEffect(() => {
    fetchConnections();

    // Listen for OAuth callback messages
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === "oauth-success") {
        console.log("OAuth success - tokens stored server-side");
        toast({
          title: "Connected Successfully",
          description: "Your account has been connected",
        });
        // Refresh connection status from database
        fetchConnections();
        // Navigate to search page
        setTimeout(() => navigate("/search"), 1000);
        setLoading(false);
      } else if (event.data.type === "oauth-error") {
        console.error("OAuth error:", event.data.error);
        toast({
          title: "Connection Failed",
          description: event.data.error,
          variant: "destructive",
        });
        setLoading(false);
        // Navigate to search page even on error
        setTimeout(() => navigate("/search"), 1500);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const fetchConnections = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('oauth_connections')
        .select('provider, is_connected')
        .eq('user_id', user.id);

      if (error) throw error;

      const connectionsMap: { [key: string]: boolean } = {};
      data?.forEach(conn => {
        connectionsMap[conn.provider] = conn.is_connected;
      });
      setConnections(connectionsMap);
    } catch (error) {
      console.error('Error fetching connections:', error);
    }
  };

  // Removed client-side token storage - now handled server-side in OAuth callback

  const handleConnect = async (provider: string) => {
    if (provider !== 'google drive') {
      toast({
        title: "Coming Soon",
        description: `${provider} integration will be available soon`,
      });
      return;
    }

    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({
          title: "Authentication Required",
          description: "Please log in to connect integrations",
          variant: "destructive",
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke('google-drive-oauth-init', {
        body: {},
      });

      if (error) throw error;

      // Open OAuth URL in popup
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      
      window.open(
        data.authUrl,
        'OAuth',
        `width=${width},height=${height},left=${left},top=${top}`
      );
    } catch (error) {
      console.error('Error initiating OAuth:', error);
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : 'Failed to initiate connection',
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Connect Your Knowledge Sources
          </h1>
          <p className="text-muted-foreground">
            Step 2 of 3: Connect at least one integration to get started
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {integrations.map((integration) => (
            <Card key={integration.name}>
              <CardHeader className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                  <img
                    src={integration.logo}
                    alt={integration.name}
                    className="max-w-full max-h-full"
                  />
                </div>
                <CardTitle className="text-lg">{integration.name}</CardTitle>
                <CardDescription>
                  {integration.connected ? (
                    <span className="flex items-center justify-center gap-1 text-accent">
                      <CheckCircle2 className="w-4 h-4" />
                      Connected
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-1">
                      <Circle className="w-4 h-4" />
                      Not Connected
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => handleConnect(integration.name.toLowerCase())}
                  className="w-full"
                  variant={integration.connected ? "outline" : "default"}
                  disabled={loading}
                >
                  {loading ? "Connecting..." : integration.connected ? "Reconnect" : `Connect ${integration.name}`}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="text-center">
          <Button
            size="lg"
            onClick={() => {
              navigate("/search");
            }}
          >
            Continue to Search
          </Button>
          <p className="text-sm text-muted-foreground mt-4">
            You can add more integrations later from settings
          </p>
        </div>
      </div>
    </div>
  );
};

export default Connect;
