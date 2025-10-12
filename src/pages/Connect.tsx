import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Circle } from "lucide-react";

const Connect = () => {
  const navigate = useNavigate();

  const integrations = [
    {
      name: "Notion",
      logo: "https://upload.wikimedia.org/wikipedia/commons/4/45/Notion_app_logo.png",
      connected: false,
    },
    {
      name: "Slack",
      logo: "https://upload.wikimedia.org/wikipedia/commons/b/b9/Slack_Technologies_Logo.svg",
      connected: false,
    },
    {
      name: "Google Drive",
      logo: "https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg",
      connected: false,
    },
  ];

  const handleConnect = (provider: string) => {
    // OAuth flow will be implemented in Week 2
    console.log("Connecting to", provider);
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
                >
                  {integration.connected ? "Reconnect" : `Connect ${integration.name}`}
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
