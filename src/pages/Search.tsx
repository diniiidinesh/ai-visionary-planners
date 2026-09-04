import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Search as SearchIcon, FileText, History, ExternalLink, Loader2, Sparkles, LogOut, User, ChevronDown, Settings, Plus, MessageSquare, BookOpen, Library } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import DOMPurify from "dompurify";
import { checkUserConnections } from "@/utils/connectionStatus";

interface SourceRef {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  relevanceScore?: number;
}

interface RagExcerpt {
  ref: number;
  title: string;
  heading?: string | null;
  author?: string | null;
  modifiedTime?: string | null;
  url?: string;
  similarity: number;
  content: string;
}

interface RagCandidate {
  title: string;
  heading?: string | null;
  chunkIndex: number;
  similarity: number | null;
  keywordScore: number | null;
  vectorRank: number | null;
  keywordRank: number | null;
  fusedScore: number | null;
  rerankScore?: number | null;
  used: boolean;
  preview: string;
}

interface RagDebug {
  mode: string;
  reranked?: boolean;
  retrievalQuery?: string | null;
  keywordQueries?: string[] | null;
  candidates: RagCandidate[];
}

// A conversation is a flat list of turns. History sent to rag-answer is
// derived from this list (previous turns only, not the one being answered),
// which is what lets the model resolve "what about Q3?" style follow-ups.
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceRef[];
  excerpts?: RagExcerpt[];
  ragDebug?: RagDebug | null;
  staleDocuments?: number;
  // Which backend path answered. 'corpus_overview' questions ("what's in my
  // Drive?") are answered from the document catalog with no retrieval at all,
  // so they carry no excerpts and their document chips are not ranked sources.
  answerMode?: "lookup" | "corpus_overview";
  isFallback?: boolean; // answered via live Drive search, not the indexed RAG path
}

const MAX_HISTORY_TURNS = 8; // sent to rag-answer; keeps the condense-query call cheap

function renderMarkdownish(text: string) {
  return DOMPurify.sanitize(
    text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline font-medium">$1</a>')
      .replace(/(?<!href="|">)(https?:\/\/[^\s<]+)(?![^<]*<\/a>)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline font-medium">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p class="mt-3">')
      .replace(/^(.+)$/, '<p>$1</p>'),
    { ALLOWED_TAGS: ['a', 'strong', 'p', 'br'], ALLOWED_ATTR: ['href', 'target', 'rel', 'class'] }
  );
}

const Search = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [recentConversations, setRecentConversations] = useState<{ id: string; title: string | null; updated_at: string }[]>([]);

  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const verify = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }
      setUserEmail(user.email || "");
      setUserName(user.user_metadata?.full_name || user.email?.split('@')[0] || "User");

      const { hasConnections } = await checkUserConnections(user.id);
      if (!hasConnections) {
        toast({ title: "No connections found", description: "Let's connect your knowledge sources first" });
        navigate("/connect");
        return;
      }

      loadRecentConversations(user.id);
    };
    verify();
  }, [navigate, toast]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const loadRecentConversations = async (userId: string) => {
    const { data } = await supabase
      .from('conversations')
      .select('id, title, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(10);
    setRecentConversations(data ?? []);
  };

  const quickExamples = [
    "Find the PRD for mobile app redesign",
    "What feedback did customers give on onboarding?",
    "Show me Q4 OKR decisions",
  ];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    setInput("");
  };

  const openConversation = async (id: string) => {
    const { data } = await supabase
      .from('conversation_messages')
      .select('id, role, content, sources, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    setConversationId(id);
    setMessages(
      (data ?? []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: m.role === 'assistant' ? (m.sources ?? []) : undefined,
      }))
    );
  };

  const handleSend = async () => {
    const question = input.trim();
    if (!question) {
      toast({ title: "Empty message", description: "Type a question first", variant: "destructive" });
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/auth");
      return;
    }

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: question };
    // History = every prior turn in this thread, oldest first, capped so the
    // condense-question call in rag-answer stays cheap and fast.
    const historyForRequest = messages
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      // Persist the conversation + this user turn up front (mirrors the
      // existing search_queries pattern: write happens client-side, the edge
      // function stays stateless).
      let convId = conversationId;
      if (!convId) {
        const { data: conv } = await supabase
          .from('conversations')
          .insert({ user_id: user.id, title: question.slice(0, 80) })
          .select('id')
          .single();
        convId = conv?.id ?? null;
        setConversationId(convId);
        if (convId) loadRecentConversations(user.id);
      }
      if (convId) {
        await supabase.from('conversation_messages').insert({
          conversation_id: convId,
          user_id: user.id,
          role: 'user',
          content: question,
        });
      }

      const { data: ragQueryRow } = await supabase
        .from('search_queries')
        .insert({ user_id: user.id, original_query: question })
        .select()
        .single();

      const ragResponse = await supabase.functions.invoke('rag-answer', {
        body: {
          question,
          queryId: ragQueryRow?.id,
          history: historyForRequest,
        },
      });

      const ragData: any = ragResponse.data;

      if (!ragResponse.error && ragData?.summary) {
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: ragData.summary,
          sources: (ragData.sources || []).map((s: any) => ({
            id: s.id,
            name: s.name,
            mimeType: s.mimeType || '',
            webViewLink: s.url,
            relevanceScore: Math.round((s.topSimilarity || 0) * 100),
          })),
          excerpts: ragData.excerpts || [],
          ragDebug: ragData.retrieval ?? null,
          staleDocuments: ragData.staleDocuments ?? 0,
          answerMode: ragData.answerMode === "corpus_overview" ? "corpus_overview" : "lookup",
        };
        setMessages((prev) => [...prev, assistantMessage]);

        if (convId) {
          await supabase.from('conversation_messages').insert({
            conversation_id: convId,
            user_id: user.id,
            role: 'assistant',
            content: ragData.summary,
            sources: assistantMessage.sources as any,
          });
        }
        return;
      }

      // Nothing indexed yet — fall back to a one-shot live Drive search + summary.
      // (Follow-up context doesn't carry into this path; it's a bootstrap path
      // for users who haven't indexed anything yet.)
      const { data: queryPlan, error: queryError } = await supabase.functions.invoke('ai-search', {
        body: { query: question },
      });
      if (queryError) throw queryError;

      const { data: searchData, error: searchError } = await supabase.functions.invoke('multi-source-search', {
        body: {
          searchVariations: queryPlan.searchVariations,
          documentTypes: queryPlan.documentTypes,
          entities: queryPlan.entities,
          originalQuery: question,
          dateRange: "all",
        },
      });
      if (searchError) {
        if (searchError.message?.includes('No Google Drive connection')) {
          toast({ title: "Connection required", description: "Please connect your Google Drive first", variant: "destructive" });
          navigate("/connect");
          return;
        }
        throw searchError;
      }

      const results = searchData.results || [];
      if (results.length === 0) {
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "❌ No matching documents found. Try a different question, or index your Drive from the Connect page for better answers.",
          isFallback: true,
        }]);
        return;
      }

      const { data: summaryData, error: summaryError } = await supabase.functions.invoke('ai-summarize', {
        body: { question, documents: results.slice(0, 10), queryId: queryPlan.queryId },
      });

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: summaryError ? "⚠️ Summary generation failed, but here are the matching documents below." : summaryData.summary,
        sources: results.map((r: any) => ({
          id: r.id,
          name: r.name,
          mimeType: r.mimeType || '',
          webViewLink: r.webViewLink,
        })),
        isFallback: true,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      if (convId) {
        await supabase.from('conversation_messages').insert({
          conversation_id: convId,
          user_id: user.id,
          role: 'assistant',
          content: assistantMessage.content,
          sources: assistantMessage.sources as any,
        });
      }
    } catch (error: any) {
      console.error("Search error:", error);
      toast({ title: "Something went wrong", description: error.message || "An error occurred", variant: "destructive" });
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "❌ Something went wrong answering that. Please try again.",
      }]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Navigation */}
      <nav className="border-b bg-card shrink-0">
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
                    <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
                  </Avatar>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{userName}</p>
                    <p className="text-xs leading-none text-muted-foreground">{userEmail}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/ai-settings")}>
                  <Settings className="mr-2 h-4 w-4" />
                  AI Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/pipeline")}>
                  <BookOpen className="mr-2 h-4 w-4" />
                  How it works
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </nav>

      <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-6 grid grid-cols-[260px_1fr] gap-6 min-h-0">
        {/* Sidebar: conversation list */}
        <div className="space-y-4">
          <Button onClick={startNewConversation} className="w-full justify-start" variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            New conversation
          </Button>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <History className="h-4 w-4" />
              <span className="font-semibold text-sm">Conversations</span>
            </div>
            <div className="space-y-1">
              {recentConversations.length === 0 && (
                <p className="text-xs text-muted-foreground">No conversations yet</p>
              )}
              {recentConversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openConversation(c.id)}
                  className={`w-full text-left p-2 rounded hover:bg-accent transition-colors flex items-start gap-2 ${conversationId === c.id ? 'bg-accent' : ''}`}
                >
                  <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="text-sm truncate">{c.title || "Untitled"}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* Main: chat thread */}
        <div className="flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto space-y-4 pb-4">
            {messages.length === 0 && (
              <Card className="p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <SearchIcon className="h-5 w-5 text-primary" />
                  Ask anything about your documents
                </h3>
                <div className="space-y-2">
                  {quickExamples.map((example, idx) => (
                    <button
                      key={idx}
                      onClick={() => setInput(example)}
                      className="w-full text-left p-3 rounded-lg border hover:border-primary hover:bg-primary/5 transition-colors"
                    >
                      <p className="text-sm">{example}</p>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-4">
                  Follow-up questions ("what about the other one?") work — this is a conversation, not a one-shot search.
                </p>
              </Card>
            )}

            {messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                {m.role === "user" ? (
                  <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5">
                    <p className="text-sm">{m.content}</p>
                  </div>
                ) : (
                  <Card className="max-w-[85%] p-5 bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
                    <div className="flex items-start gap-2 mb-2">
                      <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div
                        className="prose prose-sm max-w-none dark:prose-invert text-foreground flex-1"
                        dangerouslySetInnerHTML={{ __html: renderMarkdownish(m.content) }}
                      />
                    </div>
                    {m.isFallback && (
                      <p className="text-xs text-muted-foreground italic">Answered via live Drive search (nothing indexed yet)</p>
                    )}
                    {m.answerMode === "corpus_overview" && (
                      <p className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-[11px] text-secondary-foreground">
                        <Library className="h-3 w-3" />
                        Answered from the document catalog — exact counts, no passage search
                      </p>
                    )}

                    {!!m.excerpts?.length && (
                      <Collapsible className="mt-3">
                        <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                          <ChevronDown className="h-3.5 w-3.5" />
                          <span className="font-medium">Cited passages ({m.excerpts.length})</span>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2 space-y-2">
                          {m.excerpts.map((e) => (
                            <div key={e.ref} className="rounded-lg border bg-card/60 p-3">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary hover:underline truncate">
                                  [{e.ref}] {e.title}
                                </a>
                                <span className="text-[10px] text-muted-foreground shrink-0">{(e.similarity * 100).toFixed(0)}% match</span>
                              </div>
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">{e.content}</p>
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {m.ragDebug && (
                      <Collapsible className="mt-3">
                        <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                          <ChevronDown className="h-3.5 w-3.5" />
                          <span className="font-medium">
                            Retrieval debug · {m.ragDebug.mode}{m.ragDebug.reranked ? " · reranked" : ""}
                          </span>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2 space-y-2">
                          {m.ragDebug.retrievalQuery && (
                            <p className="text-[11px] text-muted-foreground">
                              Rewritten for retrieval: <span className="italic">"{m.ragDebug.retrievalQuery}"</span>
                            </p>
                          )}
                          {!!m.ragDebug.keywordQueries?.length && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] text-muted-foreground">Keyword queries:</span>
                              {m.ragDebug.keywordQueries.map((kq, i) => (
                                <span key={i} className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground text-[10px] font-mono">
                                  {kq}
                                </span>
                              ))}
                            </div>
                          )}
                          {m.ragDebug.candidates.map((c, i) => (
                            <div key={`${c.title}-${c.chunkIndex}-${i}`} className={`rounded-md border p-2 text-[11px] ${c.used ? "bg-primary/5 border-primary/30" : "bg-muted/30"}`}>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="font-medium truncate max-w-[14rem]">{c.title}</span>
                                <span className="text-muted-foreground">
                                  cosine {c.similarity != null ? (c.similarity * 100).toFixed(1) + "%" : "—"}
                                </span>
                                {c.rerankScore != null && (
                                  <span className="text-muted-foreground">rerank {(c.rerankScore * 100).toFixed(1)}%</span>
                                )}
                                <span className={c.used ? "text-primary font-medium" : "text-muted-foreground"}>{c.used ? "used" : "not used"}</span>
                              </div>
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {!!m.staleDocuments && m.staleDocuments > 0 && (
                      <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs">
                        {m.staleDocuments} document(s) need re-indexing — run a full re-index from the Connect page.
                      </div>
                    )}

                    {!!m.sources?.length && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {m.sources.map((s) => (
                          <a
                            key={s.id}
                            href={s.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary text-secondary-foreground text-[11px] hover:underline"
                          >
                            <FileText className="h-3 w-3" />
                            {s.name}
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ))}
                      </div>
                    )}
                  </Card>
                )}
              </div>
            ))}

            {isSending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Thinking...</span>
              </div>
            )}
            <div ref={threadEndRef} />
          </div>

          {/* Input bar */}
          <Card className="p-3 shrink-0">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                placeholder={messages.length ? "Ask a follow-up..." : "Ask anything about your documents..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                disabled={isSending}
                className="text-base py-5"
              />
              <Button onClick={handleSend} disabled={isSending} size="lg">
                {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SearchIcon className="h-5 w-5" />}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Search;
