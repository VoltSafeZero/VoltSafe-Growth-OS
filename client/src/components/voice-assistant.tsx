import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, X, Send, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useVoiceRecorder } from "../../replit_integrations/audio/useVoiceRecorder";
import { useAudioPlayback } from "../../replit_integrations/audio/useAudioPlayback";
import cortexLogo from "@assets/cortex-ai-logo.png";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function VoiceAssistant() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("open-cortex-ai", handler);
    return () => window.removeEventListener("open-cortex-ai", handler);
  }, []);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [textInput, setTextInput] = useState("");
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const recorder = useVoiceRecorder();
  const playback = useAudioPlayback();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentTranscript]);

  const handleVoiceSubmit = useCallback(async (audioBlob: Blob) => {
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
        body: JSON.stringify({
          audio: base64Audio,
          conversationId,
          voice: "nova",
        }),
      });

      if (!response.ok) throw new Error("Voice request failed");

      const streamReader = response.body?.getReader();
      if (!streamReader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { done, value } = await streamReader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            switch (event.type) {
              case "user_transcript":
                setMessages((prev) => [...prev, { role: "user", content: event.data }]);
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
                break;
              case "done":
                playback.signalComplete();
                setMessages((prev) => [...prev, { role: "assistant", content: event.transcript || assistantText }]);
                setCurrentTranscript("");
                break;
              case "error":
                console.error("Voice error:", event.error);
                break;
            }
          } catch {}
        }
      }
    } catch (error) {
      console.error("Voice assistant error:", error);
    } finally {
      setIsProcessing(false);
    }
  }, [conversationId, playback]);

  const handleMicClick = useCallback(async () => {
    if (recorder.state === "recording") {
      const blob = await recorder.stopRecording();
      if (blob.size > 0) {
        await handleVoiceSubmit(blob);
      }
    } else {
      await recorder.startRecording();
    }
  }, [recorder, handleVoiceSubmit]);

  const handleTextSubmit = useCallback(async () => {
    if (!textInput.trim() || isProcessing) return;
    const msg = textInput.trim();
    setTextInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setIsProcessing(true);
    setCurrentTranscript("");

    try {
      const response = await fetch("/api/voice-assistant/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, conversationId }),
      });

      if (!response.ok) throw new Error("Request failed");

      const streamReader = response.body?.getReader();
      if (!streamReader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await streamReader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
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
              case "done":
                setMessages((prev) => [...prev, { role: "assistant", content: event.transcript || fullText }]);
                setCurrentTranscript("");
                break;
            }
          } catch {}
        }
      }
    } catch (error) {
      console.error("Text assistant error:", error);
    } finally {
      setIsProcessing(false);
    }
  }, [textInput, isProcessing, conversationId]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-[hsl(220,30%,15%)] flex items-center justify-center shadow-lg shadow-black/30 active:scale-95 transition-transform border border-border/30"
        data-testid="button-open-voice-assistant"
      >
        <img src={cortexLogo} alt="Cortex AI" className="w-10 h-10 object-contain" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[360px] max-w-[calc(100vw-2rem)] h-[500px] max-h-[calc(100vh-4rem)] bg-background border border-border/50 rounded-2xl shadow-2xl flex flex-col overflow-hidden" data-testid="panel-voice-assistant">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[hsl(220,30%,15%)] flex items-center justify-center">
            <img src={cortexLogo} alt="Cortex AI" className="w-6 h-6 object-contain" />
          </div>
          <div>
            <p className="text-sm font-semibold">Cortex AI</p>
            <p className="text-[10px] text-muted-foreground">CRM + Web assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground"
            onClick={() => setMode(mode === "voice" ? "text" : "voice")}
            data-testid="button-toggle-mode"
          >
            {mode === "voice" ? <MessageSquare className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground"
            onClick={() => setIsOpen(false)}
            data-testid="button-close-voice-assistant"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !currentTranscript && (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full bg-[hsl(220,30%,15%)] flex items-center justify-center mx-auto mb-3">
              <img src={cortexLogo} alt="Cortex AI" className="w-8 h-8 object-contain" />
            </div>
            <p className="text-sm font-medium mb-1">Cortex AI Assistant</p>
            <p className="text-xs text-muted-foreground max-w-[240px] mx-auto">
              {mode === "voice"
                ? "Tap the microphone and ask anything — CRM data, marina info, web searches, and more."
                : "Ask about CRM data, marinas, industry news, or anything else."}
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-secondary/60 text-foreground rounded-bl-md"
              }`}
              data-testid={`message-${msg.role}-${i}`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {currentTranscript && (
          <div className="flex justify-start">
            <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-bl-md bg-secondary/60 text-foreground text-sm leading-relaxed">
              {currentTranscript}
              <span className="inline-block w-1.5 h-4 bg-primary/60 ml-0.5 animate-pulse" />
            </div>
          </div>
        )}

        {isProcessing && !currentTranscript && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-2xl rounded-bl-md bg-secondary/60">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="px-4 py-3 border-t border-border/50 bg-card/80 backdrop-blur-sm">
        {mode === "voice" ? (
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={handleMicClick}
              disabled={isProcessing}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                recorder.state === "recording"
                  ? "bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/30"
                  : isProcessing
                    ? "bg-secondary text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
              }`}
              data-testid="button-voice-record"
            >
              {recorder.state === "recording" ? (
                <MicOff className="w-6 h-6" />
              ) : (
                <Mic className="w-6 h-6" />
              )}
            </button>
            <p className="text-xs text-muted-foreground">
              {recorder.state === "recording"
                ? "Listening... tap to send"
                : isProcessing
                  ? "Processing..."
                  : "Tap to speak"}
            </p>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleTextSubmit();
            }}
            className="flex items-center gap-2"
          >
            <Input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Ask anything..."
              disabled={isProcessing}
              className="flex-1 rounded-full bg-secondary/30 border-transparent focus-visible:border-primary/50"
              data-testid="input-text-assistant"
            />
            <Button
              type="submit"
              size="icon"
              disabled={isProcessing || !textInput.trim()}
              className="rounded-full shrink-0"
              data-testid="button-send-text"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
