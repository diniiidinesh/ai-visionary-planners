import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const Auth = () => {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get("mode") || "login";
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [tier, setTier] = useState<"starter" | "professional" | "enterprise">("starter");

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1) {
      setStep(2);
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            subscription_tier: tier,
          },
        },
      });

      if (error) throw error;

      toast({
        title: "Account created!",
        description: "Welcome! Redirecting to search...",
      });

      navigate("/search");
    } catch (error: any) {
      toast({
        title: "Sign up failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      navigate("/search");
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (mode === "signup") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary/30 px-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Create Your Account</CardTitle>
            <CardDescription>
              {step === 1 ? "Step 1 of 2: Account Details" : "Step 2 of 2: Select Your Plan"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignUp} className="space-y-6">
              {step === 1 ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Full Name</Label>
                    <Input
                      id="fullName"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                    />
                    <p className="text-xs text-muted-foreground">
                      Minimum 8 characters
                    </p>
                  </div>
                  <Button type="submit" className="w-full">
                    Continue
                  </Button>
                </>
              ) : (
                <>
                  <RadioGroup value={tier} onValueChange={(v: any) => setTier(v)}>
                    <div className="space-y-4">
                      <div className="flex items-start space-x-3 border border-border rounded-lg p-4 cursor-pointer hover:border-accent transition-colors">
                        <RadioGroupItem value="starter" id="starter" />
                        <div className="flex-1">
                          <Label htmlFor="starter" className="cursor-pointer">
                            <div className="font-semibold">Starter - Free</div>
                            <div className="text-sm text-muted-foreground">
                              100 searches/month, 1 team, 3 integrations
                            </div>
                          </Label>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3 border border-border rounded-lg p-4 cursor-pointer hover:border-accent transition-colors">
                        <RadioGroupItem value="professional" id="professional" />
                        <div className="flex-1">
                          <Label htmlFor="professional" className="cursor-pointer">
                            <div className="font-semibold">Professional - $49/user/mo</div>
                            <div className="text-sm text-muted-foreground">
                              Unlimited searches, 5 teams, advanced filters
                            </div>
                          </Label>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3 border border-border rounded-lg p-4 cursor-pointer hover:border-accent transition-colors">
                        <RadioGroupItem value="enterprise" id="enterprise" />
                        <div className="flex-1">
                          <Label htmlFor="enterprise" className="cursor-pointer">
                            <div className="font-semibold">Enterprise - Custom</div>
                            <div className="text-sm text-muted-foreground">
                              SSO, dedicated support, custom AI training
                            </div>
                          </Label>
                        </div>
                      </div>
                    </div>
                  </RadioGroup>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating account...
                      </>
                    ) : (
                      `Start with ${tier.charAt(0).toUpperCase() + tier.slice(1)}`
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setStep(1)}
                  >
                    Back
                  </Button>
                </>
              )}
              <div className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => navigate("/auth?mode=login")}
                  className="text-accent hover:underline"
                >
                  Sign in
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome Back</CardTitle>
          <CardDescription>Sign in to your account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
            <div className="text-center text-sm text-muted-foreground">
              Don't have an account?{" "}
              <button
                type="button"
                onClick={() => navigate("/auth?mode=signup")}
                className="text-accent hover:underline"
              >
                Sign up
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
