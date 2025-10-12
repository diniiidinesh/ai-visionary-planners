import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Search as SearchIcon, Filter, Calendar, FileText, Users, History } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const Search = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(true);
  const [dateRange, setDateRange] = useState("all");
  const [documentTypes, setDocumentTypes] = useState<string[]>(["notion", "slack", "google_drive"]);
  const [myHistoryOnly, setMyHistoryOnly] = useState(false);

  const quickExamples = [
    "Find the PRD for mobile app redesign",
    "What feedback did customers give on onboarding?",
    "Show me Q4 OKR decisions",
  ];

  const recentSearches = [
    { query: "Feature prioritization Q2 2024", time: "2 hours ago" },
    { query: "Customer feedback analysis", time: "Yesterday" },
    { query: "Roadmap decisions", time: "3 days ago" },
  ];

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    const params = new URLSearchParams({
      q: searchQuery,
      dateRange,
      types: documentTypes.join(","),
      myHistory: myHistoryOnly.toString(),
    });
    navigate(`/search/results?${params.toString()}`);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation Bar */}
      <nav className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="font-bold text-xl text-foreground">PM Knowledge</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                <Avatar>
                  <AvatarFallback>PM</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>My Account</DropdownMenuItem>
              <DropdownMenuItem>Team Settings</DropdownMenuItem>
              <DropdownMenuItem>Billing</DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout}>Logout</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex gap-6">
          {/* Filters Sidebar */}
          <aside className="w-64 flex-shrink-0">
            <Collapsible open={filterOpen} onOpenChange={setFilterOpen}>
              <Card className="p-4">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between mb-4">
                    <span className="flex items-center gap-2">
                      <Filter className="w-4 h-4" />
                      Filters
                    </span>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-6">
                  {/* Date Range */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <Calendar className="w-4 h-4" />
                      Date Range
                    </div>
                    <RadioGroup value={dateRange} onValueChange={setDateRange}>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="all" id="all" />
                        <Label htmlFor="all" className="cursor-pointer">All time</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="last_7_days" id="last_7_days" />
                        <Label htmlFor="last_7_days" className="cursor-pointer">Last 7 days</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="last_30_days" id="last_30_days" />
                        <Label htmlFor="last_30_days" className="cursor-pointer">Last 30 days</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="last_3_months" id="last_3_months" />
                        <Label htmlFor="last_3_months" className="cursor-pointer">Last 3 months</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="last_year" id="last_year" />
                        <Label htmlFor="last_year" className="cursor-pointer">Last year</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* Document Type */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <FileText className="w-4 h-4" />
                      Document Type
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="notion"
                          checked={documentTypes.includes("notion")}
                          onCheckedChange={(checked) => {
                            setDocumentTypes(
                              checked
                                ? [...documentTypes, "notion"]
                                : documentTypes.filter((t) => t !== "notion")
                            );
                          }}
                        />
                        <Label htmlFor="notion" className="cursor-pointer">Notion pages</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="slack"
                          checked={documentTypes.includes("slack")}
                          onCheckedChange={(checked) => {
                            setDocumentTypes(
                              checked
                                ? [...documentTypes, "slack"]
                                : documentTypes.filter((t) => t !== "slack")
                            );
                          }}
                        />
                        <Label htmlFor="slack" className="cursor-pointer">Slack messages</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="google_drive"
                          checked={documentTypes.includes("google_drive")}
                          onCheckedChange={(checked) => {
                            setDocumentTypes(
                              checked
                                ? [...documentTypes, "google_drive"]
                                : documentTypes.filter((t) => t !== "google_drive")
                            );
                          }}
                        />
                        <Label htmlFor="google_drive" className="cursor-pointer">Google Drive</Label>
                      </div>
                    </div>
                  </div>

                  {/* My History */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <Users className="w-4 h-4" />
                      My History
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="myHistory"
                        checked={myHistoryOnly}
                        onCheckedChange={(checked) => setMyHistoryOnly(checked === true)}
                      />
                      <Label htmlFor="myHistory" className="cursor-pointer">
                        Show only my documents
                      </Label>
                    </div>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </aside>

          {/* Main Search Area */}
          <main className="flex-1">
            {/* Search Bar */}
            <div className="max-w-3xl mx-auto mb-8">
              <div className="relative">
                <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Ask anything... e.g., 'Why did we deprioritize feature X?'"
                  className="pl-12 pr-4 py-6 text-lg"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch();
                  }}
                />
              </div>
              <Button
                size="lg"
                className="mt-4 w-full md:w-auto"
                onClick={handleSearch}
                disabled={!searchQuery.trim()}
              >
                Search
              </Button>
            </div>

            {/* Quick Start Examples */}
            <div className="mb-8">
              <h3 className="text-sm font-semibold text-foreground mb-3">Quick Start</h3>
              <div className="grid gap-3">
                {quickExamples.map((example, i) => (
                  <Card
                    key={i}
                    className="p-4 cursor-pointer hover:border-accent transition-colors"
                    onClick={() => setSearchQuery(example)}
                  >
                    <p className="text-sm text-foreground">{example}</p>
                  </Card>
                ))}
              </div>
            </div>

            {/* Recent Searches */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <History className="w-4 h-4" />
                Recent Searches
              </h3>
              <div className="space-y-2">
                {recentSearches.map((search, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors"
                    onClick={() => setSearchQuery(search.query)}
                  >
                    <span className="text-sm text-foreground">{search.query}</span>
                    <span className="text-xs text-muted-foreground">{search.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default Search;
