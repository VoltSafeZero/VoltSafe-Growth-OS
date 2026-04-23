import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, X, Send, MessageSquare, Plus, History, ChevronLeft, Trash2, Sparkles, Bot, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useVoiceRecorder } from "../../replit_integrations/audio/useVoiceRecorder";
import { useAudioPlayback } from "../../replit_integrations/audio/useAudioPlayback";
import cortexLogo from "@assets/cortex-ai-logo.png";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = {
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
};

type Conversation = {
  id: number;
  title: string;
  createdAt: string;
};

const SUGGESTION_CHIPS = [
  { label: "Pipeline overview", icon: Sparkles },
  { label: "Overdue tasks", icon: Sparkles },
  { label: "Recent leads", icon: Sparkles },
  { label: "Open tickets", icon: Sparkles },
  { label: "Today's schedule", icon: Sparkles },
  { label: "Top marinas by deal value", icon: Sparkles },
];

function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        h1: ({ children }) => <h1 className="text-base font-bold mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
        code: ({ children, className }) => {
          const isInline = !className;
          if (isInline) {
            return <code className="bg-background/50 px-1 py-0.5 rounded text-xs font-mono text-primary">{children}</code>;
          }
          return <code className="block bg-background/50 p-2 rounded-lg text-xs font-mono overflow-x-auto mb-2">{children}</code>;
        },
        pre: ({ children }) => <pre className="mb-2">{children}</pre>,
        table: ({ children }) => <div className="overflow-x-auto mb-2"><table className="text-xs border-collapse w-full">{children}</table></div>,
        th: ({ children }) => <th className="border border-border/50 px-2 py-1 text-left font-semibold bg-background/30">{children}</th>,
        td: ({ children }) => <td className="border border-border/50 px-2 py-1">{children}</td>,
        a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{children}</a>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground mb-2">{children}</blockquote>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function VoiceAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const hasLoadedMostRecent = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const turnIdRef = useRef(0);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [textInput, setTextInput] = useState("");
  const [mode, setMode] = useState<"voice" | "text">("text");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const recorder = useVoiceRecorder();
  const playback = useAudioPlayback();

  const abortCurrentRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    turnIdRef.current++;
  }, []);

  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("open-cortex-ai", handler);
    return () => window.removeEventListener("open-cortex-ai", handler);
  }, []);

  useEffect(() => {
    if (isOpen && !hasLoadedMostRecent.current) {
      hasLoadedMostRecent.current = true;
      fetch("/api/voice-assistant/conversations", { credentials: "include" })
        .then(res => res.ok ? res.json() : [])
        .then((convos: Conversation[]) => {
          if (convos.length > 0) {
            const latest = convos[0];
            fetch(`/api/voice-assistant/conversations/${latest.id}/messages`, { credentials: "include" })
              .then(res => res.ok ? res.json() : [])
              .then((msgs: any[]) => {
                if (msgs.length > 0) {
                  setMessages(msgs.map((m: any) => ({ role: m.role, content: m.content, timestamp: new Date(m.createdAt) })));
                  setConversationId(latest.id);
                }
              });
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  const stopSpeaking = useCallback(() => {
    abortCurrentRequest();
    playback.clear();
    setIsSpeaking(false);
    setIsProcessing(false);
    setCurrentTranscript("");
  }, [playback, abortCurrentRequest]);

  const handleClose = useCallback(() => {
    if (recorder.state === "recording") recorder.stopRecording();
    abortCurrentRequest();
    playback.clear();
    setIsSpeaking(false);
    setIsProcessing(false);
    setCurrentTranscript("");
    hasLoadedMostRecent.current = false;
    setIsOpen(false);
  }, [recorder, playback, abortCurrentRequest]);

  useEffect(() => {
    if (playback.state === "idle" && isSpeaking) {
      setIsSpeaking(false);
    }
  }, [playback.state, isSpeaking]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentTranscript]);

  const loadConversations = useCallback(async () => {
    setConversationsLoading(true);
    try {
      const res = await fetch("/api/voice-assistant/conversations", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch (e) {
      console.error("Failed to load conversations:", e);
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  const loadConversation = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/voice-assistant/conversations/${id}/messages`, { credentials: "include" });
      if (res.ok) {
        const msgs = await res.json();
        setMessages(msgs.map((m: any) => ({ role: m.role, content: m.content, timestamp: new Date(m.createdAt) })));
        setConversationId(id);
        setShowHistory(false);
      }
    } catch (e) {
      console.error("Failed to load conversation:", e);
    }
  }, []);

  const deleteConversation = useCallback(async (id: number) => {
    try {
      await fetch(`/api/voice-assistant/conversations/${id}`, { method: "DELETE", credentials: "include" });
      setConversations(prev => prev.filter(c => c.id !== id));
      if (conversationId === id) {
        setMessages([]);
        setConversationId(null);
      }
    } catch (e) {
      console.error("Failed to delete conversation:", e);
    }
  }, [conversationId]);

  const startNewChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setCurrentTranscript("");
    setShowHistory(false);
  }, []);

  const handleVoiceSubmit = useCallback(async (audioBlob: Blob) => {
    abortCurrentRequest();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const myTurn = ++turnIdRef.current;

    setIsProcessing(true);
    setCurrentTranscript("");

    try {
      await playback.init();
      playback.clear();

      const base64Audio = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.readAsDataURL(audioBlob);
      });

      const response = await fetch("/api/voice-assistant/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64Audio, conversationId, voice: "nova" }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error("Voice request failed");

      const streamReader = response.body?.getReader();
      if (!streamReader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { done, value } = await streamReader.read();
        if (done || turnIdRef.current !== myTurn) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ") || turnIdRef.current !== myTurn) continue;
          try {
            const event = JSON.parse(line.slice(6));
            switch (event.type) {
              case "user_transcript":
                setMessages(prev => [...prev, { role: "user", content: event.data, timestamp: new Date() }]);
                break;
              case "conversation_id":
                setConversationId(event.data);
                break;
              case "transcript":
                assistantText += event.data;
                setCurrentTranscript(assistantText);
                break;
              case "audio":
                playback.pushAudio(event.data);
                setIsSpeaking(true);
                break;
              case "done":
                playback.signalComplete();
                setMessages(prev => [...prev, { role: "assistant", content: event.transcript || assistantText, timestamp: new Date() }]);
                setCurrentTranscript("");
                break;
              case "error":
                console.error("Voice error:", event.error);
                setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again.", timestamp: new Date() }]);
                setCurrentTranscript("");
                break;
            }
          } catch {}
        }
      }
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      console.error("Voice assistant error:", error);
      if (turnIdRef.current === myTurn) {
        setMessages(prev => [...prev, { role: "assistant", content: "Connection error. Please try again.", timestamp: new Date() }]);
      }
    } finally {
      if (turnIdRef.current === myTurn) {
        setIsProcessing(false);
      }
    }
  }, [conversationId, playback, abortCurrentRequest]);

  const handleMicClick = useCallback(async () => {
    if (isSpeaking) {
      abortCurrentRequest();
      playback.clear();
      setIsSpeaking(false);
      setIsProcessing(false);
      setCurrentTranscript("");
    }
    if (recorder.state === "recording") {
      const blob = await recorder.stopRecording();
      if (blob.size > 0) {
        await handleVoiceSubmit(blob);
      }
    } else {
      await recorder.startRecording();
    }
  }, [recorder, handleVoiceSubmit, isSpeaking, playback, abortCurrentRequest]);

  const sendTextMessage = useCallback(async (msg: string) => {
    abortCurrentRequest();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const myTurn = ++turnIdRef.current;

    setMessages(prev => [...prev, { role: "user", content: msg, timestamp: new Date() }]);
    setIsProcessing(true);
    setCurrentTranscript("");

    try {
      const response = await fetch("/api/voice-assistant/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, conversationId }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error("Request failed");

      const streamReader = response.body?.getReader();
      if (!streamReader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await streamReader.read();
        if (done || turnIdRef.current !== myTurn) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ") || turnIdRef.current !== myTurn) continue;
          try {
            const event = JSON.parse(line.slice(6));
            switch (event.type) {
              case "conversation_id":
                setConversationId(event.data);
                break;
              case "text":
                fullText += event.data;
                setCurrentTranscript(fullText);
                break;
              case "tool_action":
                setCurrentTranscript(prev => prev ? prev + "\n\n---\n" + event.data : event.data);
                break;
              case "done":
                setMessages(prev => [...prev, { role: "assistant", content: event.transcript || fullText, timestamp: new Date() }]);
                setCurrentTranscript("");
                break;
              case "error":
                setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again.", timestamp: new Date() }]);
                setCurrentTranscript("");
                break;
            }
          } catch {}
        }
      }
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      console.error("Text assistant error:", error);
      if (turnIdRef.current === myTurn) {
        setMessages(prev => [...prev, { role: "assistant", content: "Connection error. Please try again.", timestamp: new Date() }]);
      }
    } finally {
      if (turnIdRef.current === myTurn) {
        setIsProcessing(false);
      }
    }
  }, [conversationId, abortCurrentRequest]);

  const handleTextSubmit = useCallback(async () => {
    if (!textInput.trim() || isProcessing) return;
    const msg = textInput.trim();
    setTextInput("");
    await sendTextMessage(msg);
  }, [textInput, isProcessing, sendTextMessage]);

  const handleSuggestionClick = useCallback((label: string) => {
    setMode("text");
    sendTextMessage(label);
  }, [sendTextMessage]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
        data-testid="overlay-voice-assistant"
      />

      <div
        className="fixed top-0 right-0 z-[70] h-full w-full sm:w-[440px] bg-background border-l border-border/50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300"
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
        data-testid="panel-voice-assistant"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card/90 backdrop-blur-md">
          {showHistory ? (
            <>
              <button onClick={() => setShowHistory(false)} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" data-testid="button-back-from-history">
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
              <p className="text-sm font-semibold">Conversation History</p>
              <div className="w-16" />
            </>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-1 ring-primary/20">
                  <img src={cortexLogo} alt="Cortex" className="w-6 h-6 object-contain" />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-tight">Cortex</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">VoltSafe Growth OS Assistant</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                  onClick={startNewChat}
                  title="New conversation"
                  data-testid="button-new-chat"
                >
                  <Plus className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => { setShowHistory(true); loadConversations(); }}
                  title="Conversation history"
                  data-testid="button-show-history"
                >
                  <History className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => setMode(mode === "voice" ? "text" : "voice")}
                  title={mode === "voice" ? "Switch to text" : "Switch to voice"}
                  data-testid="button-toggle-mode"
                >
                  {mode === "voice" ? <MessageSquare className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                  onClick={handleClose}
                  data-testid="button-close-voice-assistant"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </div>

        {showHistory ? (
          <div className="flex-1 overflow-y-auto">
            {conversationsLoading ? (
              <div className="p-4 space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-secondary/30 animate-pulse" />
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-16">
                <History className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No conversations yet</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors group ${
                      conv.id === conversationId ? "bg-primary/10 border border-primary/20" : "hover:bg-secondary/40"
                    }`}
                    data-testid={`conversation-${conv.id}`}
                  >
                    <div className="flex-1 min-w-0" onClick={() => loadConversation(conv.id)}>
                      <p className="text-sm font-medium truncate">{conv.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(conv.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                      data-testid={`delete-conversation-${conv.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.length === 0 && !currentTranscript && (
                <div className="flex flex-col items-center justify-center h-full py-8">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-4 ring-1 ring-primary/10">
                    <img src={cortexLogo} alt="Cortex" className="w-10 h-10 object-contain" />
                  </div>
                  <p className="text-base font-semibold mb-1">Cortex</p>
                  <p className="text-xs text-muted-foreground text-center max-w-[280px] mb-6">
                    Your VoltSafe Growth OS AI assistant — full database access and web search. Ask me anything about your marina pipeline, accounts, tasks, or industry news.
                  </p>
                  <div className="grid grid-cols-2 gap-2 w-full max-w-[340px]">
                    {SUGGESTION_CHIPS.map((chip) => (
                      <button
                        key={chip.label}
                        onClick={() => handleSuggestionClick(chip.label)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-card/50 hover:bg-secondary/40 hover:border-primary/30 transition-colors text-left"
                        data-testid={`suggestion-${chip.label.toLowerCase().replace(/\s/g, '-')}`}
                      >
                        <Sparkles className="w-3 h-3 text-primary shrink-0" />
                        <span className="text-xs text-muted-foreground">{chip.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "assistant" && (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0 mt-0.5 ring-1 ring-primary/10">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                  )}
                  <div className={`max-w-[85%] ${msg.role === "user" ? "" : ""}`}>
                    <div
                      className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-secondary/50 text-foreground rounded-bl-md border border-border/30"
                      }`}
                      data-testid={`message-${msg.role}-${i}`}
                    >
                      {msg.role === "assistant" ? (
                        <div className="prose-sm prose-invert max-w-none">
                          <MarkdownMessage content={msg.content} />
                        </div>
                      ) : (
                        msg.content
                      )}
                    </div>
                    {msg.timestamp && (
                      <p className={`text-[9px] text-muted-foreground/60 mt-0.5 ${msg.role === "user" ? "text-right" : "text-left"} px-1`}>
                        {msg.timestamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {currentTranscript && (
                <div className="flex gap-2.5 justify-start">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0 mt-0.5 ring-1 ring-primary/10">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-secondary/50 text-foreground text-sm leading-relaxed border border-border/30">
                    <div className="prose-sm prose-invert max-w-none">
                      <MarkdownMessage content={currentTranscript} />
                    </div>
                    <span className="inline-block w-1.5 h-4 bg-primary/60 ml-0.5 animate-pulse rounded-sm" />
                  </div>
                </div>
              )}

              {isProcessing && !currentTranscript && (
                <div className="flex gap-2.5 justify-start">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0 ring-1 ring-primary/10">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-secondary/50 border border-border/30">
                    <div className="flex gap-1.5 items-center">
                      <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce [animation-delay:0ms]" />
                      <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce [animation-delay:150ms]" />
                      <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="px-4 py-3 border-t border-border/50 bg-card/90 backdrop-blur-md">
              {mode === "voice" ? (
                <div className="flex items-center justify-center gap-4">
                  <button
                    onClick={handleMicClick}
                    disabled={isProcessing && !isSpeaking}
                    className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                      recorder.state === "recording"
                        ? "bg-red-500 text-white shadow-lg shadow-red-500/30"
                        : isProcessing && !isSpeaking
                          ? "bg-secondary text-muted-foreground cursor-not-allowed"
                          : "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/40"
                    }`}
                    data-testid="button-voice-record"
                  >
                    {recorder.state === "recording" ? (
                      <MicOff className="w-6 h-6" />
                    ) : (
                      <Mic className="w-6 h-6" />
                    )}
                  </button>
                  {isSpeaking && (
                    <button
                      onClick={stopSpeaking}
                      className="w-10 h-10 rounded-full bg-red-500/90 text-white flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-red-500/20"
                      data-testid="button-stop-speaking"
                      title="Stop speaking"
                    >
                      <Square className="w-4 h-4 fill-current" />
                    </button>
                  )}
                  {recorder.state === "recording" && (
                    <div className="flex items-center gap-2">
                      <div className="flex gap-0.5 items-end h-5">
                        {[...Array(5)].map((_, i) => (
                          <div key={i} className="w-1 bg-red-400 rounded-full animate-pulse" style={{ height: `${8 + Math.random() * 12}px`, animationDelay: `${i * 100}ms` }} />
                        ))}
                      </div>
                      <p className="text-xs text-red-400 font-medium">Recording...</p>
                    </div>
                  )}
                  {recorder.state === "idle" && !isProcessing && !isSpeaking && (
                    <p className="text-xs text-muted-foreground">Tap to speak</p>
                  )}
                  {isSpeaking && (
                    <p className="text-xs text-muted-foreground">Speaking... tap mic or stop to interrupt</p>
                  )}
                  {isProcessing && !isSpeaking && recorder.state === "idle" && (
                    <p className="text-xs text-muted-foreground">Processing...</p>
                  )}
                </div>
              ) : (
                <form
                  onSubmit={(e) => { e.preventDefault(); handleTextSubmit(); }}
                  className="flex items-center gap-2"
                >
                  <Input
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="Ask Cortex anything..."
                    disabled={isProcessing}
                    className="flex-1 rounded-full bg-secondary/30 border-border/30 focus-visible:border-primary/50 focus-visible:ring-primary/20 h-10"
                    data-testid="input-text-assistant"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={isProcessing || !textInput.trim()}
                    className="rounded-full shrink-0 h-10 w-10"
                    data-testid="button-send-text"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
