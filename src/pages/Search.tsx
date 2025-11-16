import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Search as SearchIcon, Filter, Calendar, FileText, Users, History, ExternalLink, Loader2, Sparkles, LogOut, User, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { checkUserConnections } from "@/utils/connectionStatus";

interface SearchResult {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  modifiedTime: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
  relevanceScore?: number;
  source?: string;
}

type SearchStage = 'idle' | 'processing' | 'searching' | 'summarizing' | 'done';

const Search = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(true);
  const [dateRange, setDateRange] = useState("all");
  const [documentTypes, setDocumentTypes] = useState<string[]>(["google_drive"]);
  const [myHistoryOnly, setMyHistoryOnly] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [aiSummary, setAiSummary] = useState<string>("");
  const [searchStage, setSearchStage] = useState<SearchStage>('idle');
  const [queryId, setQueryId] = useState<string | null>(null);

  useEffect(() => {
    const verifyConnections = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }
      
      const { hasConnections } = await checkUserConnections(user.id);
      if (!hasConnections) {
        toast({
          title: "No connections found",
          description: "Let's connect your knowledge sources first",
        });
        navigate("/connect");
      }
    };
    
    verifyConnections();
  }, [navigate, toast]);

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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast({
        title: "Empty search",
        description: "Please enter a search query",
        variant: "destructive",
      });
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    setSearchResults([]);
    setAiSummary("");
    setSearchStage('processing');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast({
          title: "Not authenticated",
          description: "Please log in to search",
          variant: "destructive",
        });
        navigate("/auth");
        return;
      }

      console.log("Step 1: AI Query Processing...");
      
      // Step 1: AI Query Processing
      const { data: queryPlan, error: queryError } = await supabase.functions.invoke('ai-search', {
        body: { query: searchQuery }
      });

      if (queryError) {
        console.error("Query processing error:", queryError);
        throw queryError;
      }

      console.log("Query processed:", queryPlan);
      setQueryId(queryPlan.queryId);
      setSearchStage('searching');

      // Step 2: Multi-Source Search
      console.log("Step 2: Searching sources...");
      const { data: searchData, error: searchError } = await supabase.functions.invoke('multi-source-search', {
        body: { 
          searchVariations: queryPlan.searchVariations,
          documentTypes: queryPlan.documentTypes,
          entities: queryPlan.entities,
          originalQuery: searchQuery,
          dateRange: dateRange
        }
      });

      if (searchError) {
        console.error("Search error:", searchError);
        
        if (searchError.message?.includes('No Google Drive connection')) {
          toast({
            title: "Connection required",
            description: "Please connect your Google Drive first",
            variant: "destructive",
          });
          navigate("/connect");
          return;
        }

        throw searchError;
      }

      console.log("Search complete:", searchData);
      const results = searchData.results || [];
      setSearchResults(results);

      if (results.length === 0) {
        setSearchStage('done');
        toast({
          title: "No results found",
          description: "Try a different search query",
        });
        setIsSearching(false);
        return;
      }

      setSearchStage('summarizing');

      // Step 3: AI Summarization
      console.log("Step 3: Generating AI summary...");
      const { data: summaryData, error: summaryError } = await supabase.functions.invoke('ai-summarize', {
        body: {
          question: searchQuery,
          documents: results.slice(0, 10),
          queryId: queryPlan.queryId
        }
      });

      if (summaryError) {
        console.error("Summary error:", summaryError);
        // Don't fail the whole search if summary fails
        toast({
          title: "Summary generation failed",
          description: "But search results are available below",
          variant: "destructive",
        });
      } else {
        console.log("Summary generated");
        setAiSummary(summaryData.summary);
      }

      setSearchStage('done');
      toast({
        title: "Search complete",
        description: `Found ${results.length} result(s) with AI summary`,
      });

    } catch (error: any) {
      console.error("Search error:", error);
      toast({
        title: "Search failed",
        description: error.message || "An error occurred during search",
        variant: "destructive",
      });
      setSearchStage('idle');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation */}
      <nav className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SearchIcon className="h-6 w-6 text-primary" />
              <span className="text-xl font-semibold">Knowledge Search</span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-[280px_1fr] gap-8">
          {/* Sidebar */}
          <div className="space-y-6">
            {/* Filters */}
            <Card className="p-4">
              <Collapsible open={filterOpen} onOpenChange={setFilterOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4" />
                    <span className="font-semibold">Filters</span>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4 space-y-4">
                  {/* Date Range */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Date Range
                    </Label>
                    <RadioGroup value={dateRange} onValueChange={setDateRange}>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="all" id="all" />
                        <Label htmlFor="all" className="font-normal cursor-pointer">All time</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="week" id="week" />
                        <Label htmlFor="week" className="font-normal cursor-pointer">Past week</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="month" id="month" />
                        <Label htmlFor="month" className="font-normal cursor-pointer">Past month</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* Document Types */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Document Types
                    </Label>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          id="google_drive" 
                          checked={documentTypes.includes("google_drive")}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setDocumentTypes([...documentTypes, "google_drive"]);
                            } else {
                              setDocumentTypes(documentTypes.filter(t => t !== "google_drive"));
                            }
                          }}
                        />
                        <Label htmlFor="google_drive" className="font-normal cursor-pointer">
                          Google Drive
                        </Label>
                      </div>
                    </div>
                  </div>

                  {/* My History */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Scope
                    </Label>
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="myHistory" 
                        checked={myHistoryOnly}
                        onCheckedChange={(checked) => setMyHistoryOnly(checked as boolean)}
                      />
                      <Label htmlFor="myHistory" className="font-normal cursor-pointer">
                        Only my documents
                      </Label>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>

            {/* Recent Searches */}
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <History className="h-4 w-4" />
                <span className="font-semibold">Recent Searches</span>
              </div>
              <div className="space-y-2">
                {recentSearches.map((search, idx) => (
                  <button
                    key={idx}
                    className="w-full text-left p-2 rounded hover:bg-accent transition-colors"
                    onClick={() => setSearchQuery(search.query)}
                  >
                    <p className="text-sm font-medium truncate">{search.query}</p>
                    <p className="text-xs text-muted-foreground">{search.time}</p>
                  </button>
                ))}
              </div>
            </Card>
          </div>

          {/* Main Content */}
          <div className="space-y-6">
            {/* Search Bar */}
            <Card className="p-6">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    placeholder="Ask anything about your documents..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    className="text-lg py-6"
                  />
                  <Button 
                    onClick={handleSearch} 
                    disabled={isSearching}
                    size="lg"
                    className="px-8"
                  >
                    {isSearching ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        {searchStage === 'processing' && 'Processing...'}
                        {searchStage === 'searching' && 'Searching...'}
                        {searchStage === 'summarizing' && 'Summarizing...'}
                      </>
                    ) : (
                      <>
                        <SearchIcon className="mr-2 h-5 w-5" />
                        Search
                      </>
                    )}
                  </Button>
                </div>
                
                {isSearching && searchStage !== 'idle' && (
                  <div className="mt-3 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      {searchStage === 'processing' && (
                        <>
                          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                          <span>Analyzing your question...</span>
                        </>
                      )}
                      {searchStage === 'searching' && (
                        <>
                          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                          <span>Searching across your documents...</span>
                        </>
                      )}
                      {searchStage === 'summarizing' && (
                        <>
                          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                          <span>Generating AI summary...</span>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* AI Summary */}
            {hasSearched && aiSummary && (
              <Card className="p-6 bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
                <div className="flex items-start gap-3 mb-4">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold mb-1">AI Summary</h2>
                    <p className="text-sm text-muted-foreground">
                      Generated by Gemini 2.5 Pro • Based on {searchResults.length} document(s)
                    </p>
                  </div>
                </div>
                <div 
                  className="prose prose-sm max-w-none dark:prose-invert"
                  dangerouslySetInnerHTML={{ 
                    __html: aiSummary
                      .replace(/\[Source: ([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline font-medium">[$1]</a>')
                      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                      .replace(/\n\n/g, '</p><p class="mt-4">')
                      .replace(/^(.+)$/, '<p>$1</p>')
                  }}
                />
              </Card>
            )}

            {/* Search Results */}
            {hasSearched && (
              <div className="space-y-4">
                {searchResults.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-semibold">
                        Sources ({searchResults.length})
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Sorted by relevance
                      </p>
                    </div>
                    <div className="grid gap-4">
                      {searchResults.map((result) => (
                        <Card key={result.id} className="p-6 hover:shadow-lg transition-shadow">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <FileText className="h-5 w-5 text-primary" />
                                <h3 className="font-semibold text-lg">{result.name}</h3>
                                {result.relevanceScore && result.relevanceScore > 10 && (
                                  <span className="px-2 py-1 text-xs bg-primary/10 text-primary rounded-full">
                                    High relevance
                                  </span>
                                )}
                              </div>
                              <div className="space-y-2 text-sm text-muted-foreground">
                                <p>Type: {result.mimeType}</p>
                                {result.owners && result.owners[0] && (
                                  <p>Owner: {result.owners[0].displayName}</p>
                                )}
                                <p>
                                  Last modified: {new Date(result.modifiedTime).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(result.webViewLink, '_blank')}
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Open
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </>
                ) : (
                  <Card className="p-12 text-center">
                    <h3 className="text-xl font-semibold mb-2">No results found</h3>
                    <p className="text-muted-foreground">
                      Try adjusting your search query or filters
                    </p>
                  </Card>
                )}
              </div>
            )}

            {/* Quick Start Examples (shown when no search) */}
            {!hasSearched && (
              <div className="space-y-6">
                <Card className="p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <SearchIcon className="h-5 w-5 text-primary" />
                    Quick Start Examples
                  </h3>
                  <div className="space-y-2">
                    {quickExamples.map((example, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSearchQuery(example)}
                        className="w-full text-left p-3 rounded-lg border hover:border-primary hover:bg-primary/5 transition-colors"
                      >
                        <p className="text-sm">{example}</p>
                      </button>
                    ))}
                  </div>
                </Card>

                <Card className="p-6 bg-primary/5">
                  <h3 className="font-semibold mb-2">How it works</h3>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <div className="flex gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                        1
                      </div>
                      <p>AI analyzes your question to understand what you're looking for</p>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                        2
                      </div>
                      <p>Searches across all your connected sources</p>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                        3
                      </div>
                      <p>Generates a comprehensive summary with sources cited</p>
                    </div>
                  </div>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Search;
