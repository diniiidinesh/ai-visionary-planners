import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";

const Landing = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary/90 to-accent py-20 px-6 text-center">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-bold text-primary-foreground mb-6">
            Find Any PM Decision in Seconds—Across All Your Tools
          </h1>
          <p className="text-xl text-primary-foreground/90 mb-8 max-w-2xl mx-auto">
            AI-powered knowledge search for Notion, Slack, and Google Drive
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Button size="lg" onClick={() => navigate("/auth?mode=signup")} className="bg-primary-foreground text-primary hover:bg-primary-foreground/90">
              Start Free Trial
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/auth?mode=login")} className="border-primary-foreground text-primary-foreground hover:bg-primary-foreground/10">
              Sign In
            </Button>
          </div>
        </div>
      </section>

      {/* Problem/Solution Section */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Stop Wasting Time Searching
          </h2>
          <p className="text-xl text-muted-foreground mb-12">
            PMs waste 8+ hours/week searching for context buried across tools. Our unified AI search understands product decisions, not just keywords.
          </p>
        </div>
      </section>

      {/* Pricing Tiers Section */}
      <section className="py-20 px-6 bg-secondary/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-12">
            Choose Your Plan
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {/* Starter */}
            <div className="bg-card border border-border rounded-lg p-8 shadow-sm">
              <h3 className="text-2xl font-bold text-foreground mb-2">Starter</h3>
              <p className="text-3xl font-bold text-foreground mb-6">Free</p>
              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <span className="text-card-foreground">100 searches/month</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <span className="text-card-foreground">1 team</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <span className="text-card-foreground">3 integrations (Notion, Slack, Drive)</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <span className="text-card-foreground">AI summaries</span>
                </li>
              </ul>
              <Button onClick={() => navigate("/auth?mode=signup")} className="w-full">
                Start Free
              </Button>
            </div>

            {/* Professional */}
            <div className="bg-card border-2 border-accent rounded-lg p-8 shadow-lg relative">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-accent text-accent-foreground px-4 py-1 rounded-full text-sm font-semibold">
                Popular
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-2">Professional</h3>
              <p className="text-3xl font-bold text-foreground mb-1">$49<span className="text-lg font-normal text-muted-foreground">/user/mo</span></p>
              <ul className="space-y-3 mb-8 mt-6">
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <span className="text-card-foreground">Unlimited searches</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <span className="text-card-foreground">5 teams</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <span className="text-card-foreground">Advanced filters</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <span className="text-card-foreground">Priority support</span>
                </li>
              </ul>
              <Button onClick={() => navigate("/auth?mode=signup")} className="w-full bg-accent hover:bg-accent/90">
                Start Trial
              </Button>
            </div>

            {/* Enterprise */}
            <div className="bg-card border border-border rounded-lg p-8 shadow-sm">
              <h3 className="text-2xl font-bold text-foreground mb-2">Enterprise</h3>
              <p className="text-3xl font-bold text-foreground mb-6">Custom</p>
              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <span className="text-card-foreground">Unlimited everything</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <span className="text-card-foreground">SSO</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <span className="text-card-foreground">Dedicated support</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                  <span className="text-card-foreground">Custom AI training</span>
                </li>
              </ul>
              <Button onClick={() => navigate("/auth?mode=signup")} variant="outline" className="w-full">
                Contact Sales
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-16">
            How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-12">
            <div className="text-center">
              <div className="w-16 h-16 bg-accent/10 text-accent rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                1
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-3">Connect Your Tools</h3>
              <p className="text-muted-foreground">
                Securely connect Notion, Slack, and Google Drive with one-click OAuth
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-accent/10 text-accent rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                2
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-3">AI Indexes Your Knowledge</h3>
              <p className="text-muted-foreground">
                Our AI automatically processes and understands your documents
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-accent/10 text-accent rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                3
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-3">Search & Get Answers</h3>
              <p className="text-muted-foreground">
                Ask questions naturally and get instant, relevant answers with AI summaries
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12 px-6">
        <div className="max-w-6xl mx-auto text-center text-muted-foreground">
          <p className="mb-4">© 2024 PM Knowledge Intelligence. All rights reserved.</p>
          <div className="flex gap-6 justify-center text-sm">
            <a href="#" className="hover:text-foreground transition-colors">Documentation</a>
            <a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-foreground transition-colors">Terms of Service</a>
            <a href="mailto:support@pmknowledge.com" className="hover:text-foreground transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
