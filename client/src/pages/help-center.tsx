import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { BookOpen, GraduationCap, Zap, Download, Search, ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import quickStartRaw from "../docs/quick-start-guide.md?raw";
import opsManualRaw from "../docs/operations-manual.md?raw";
import trainingRaw from "../docs/training-handbook.md?raw";
import kbData from "../docs/ai-knowledge-base.json";

type FAQ = { id: string; question: string; answer: string; tags: string[] };

function mdToHtml(md: string): string {
  let html = md;

  // Escape HTML special chars inside code blocks first (protect them)
  const codeBlocks: string[] = [];
  html = html.replace(/```[\s\S]*?```/g, (m) => {
    const lang = m.match(/^```(\w*)/)?.[1] ?? "";
    const code = m.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    codeBlocks.push(`<pre><code${lang ? ` class="language-${lang}"` : ""}>${escaped}</code></pre>`);
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`);

  // Tables
  html = html.replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, (_, header, body) => {
    const th = header.split("|").filter(Boolean).map((c: string) => `<th>${c.trim()}</th>`).join("");
    const rows = body.trim().split("\n").map((row: string) =>
      "<tr>" + row.split("|").filter(Boolean).map((c: string) => `<td>${c.trim()}</td>`).join("") + "</tr>"
    ).join("");
    return `<table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Headings
  html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // Horizontal rules
  html = html.replace(/^(?:---|\*\*\*|___)\s*$/gm, "<hr>");

  // Blockquotes (single-level)
  html = html.replace(/^>\s?(.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/<\/blockquote>\n<blockquote>/g, "\n");

  // Unordered lists
  html = html.replace(/((?:^[-*+]\s.+\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map(l => `<li>${l.replace(/^[-*+]\s/, "")}</li>`).join("");
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  html = html.replace(/((?:^\d+\.\s.+\n?)+)/gm, (block) => {
    const items = block.trim().split("\n").map(l => `<li>${l.replace(/^\d+\.\s/, "")}</li>`).join("");
    return `<ol>${items}</ol>`;
  });

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");

  // Links and images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%">');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Paragraphs — wrap non-block lines
  html = html.replace(/^(?!<[hupbolistabletrd]).+$/gm, (line) => {
    if (line.trim() === "" || line.startsWith("\x00CODE")) return line;
    return `<p>${line}</p>`;
  });

  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    html = html.replace(`\x00CODE${i}\x00`, block);
  });

  return html;
}

function MarkdownDoc({ content, title }: { content: string; title: string }) {
  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const bodyHtml = mdToHtml(content);
    const css = `
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 24px; color: #111; line-height: 1.7; font-size: 15px; }
      h1 { font-size: 2em; border-bottom: 2px solid #0ea5e9; padding-bottom: 0.3em; margin-top: 0.5em; }
      h2 { font-size: 1.5em; margin-top: 2em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.2em; }
      h3 { font-size: 1.2em; margin-top: 1.5em; color: #0f172a; }
      h4, h5, h6 { margin-top: 1.2em; }
      p { margin: 0.6em 0; }
      table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
      th { background: #f1f5f9; font-weight: 600; }
      code { background: #f1f5f9; padding: 2px 5px; border-radius: 3px; font-size: 0.88em; font-family: ui-monospace, monospace; }
      pre { background: #f1f5f9; padding: 12px 16px; border-radius: 6px; overflow-x: auto; margin: 1em 0; }
      pre code { background: none; padding: 0; font-size: 0.88em; }
      blockquote { border-left: 4px solid #0ea5e9; margin: 1em 0; padding: 4px 0 4px 16px; color: #475569; background: #f8fafc; }
      a { color: #0ea5e9; }
      ul, ol { padding-left: 1.75em; margin: 0.5em 0; }
      li { margin: 0.3em 0; }
      hr { border: none; border-top: 1px solid #e2e8f0; margin: 2em 0; }
      img { max-width: 100%; }
      @media print {
        body { margin: 0; }
        a { color: #0ea5e9; }
        pre, code, blockquote { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `;

    printWindow.document.write(`<!DOCTYPE html><html><head>
      <title>${title} — VoltSafe Cortex</title>
      <meta charset="utf-8" />
      <style>${css}</style>
    </head><body>${bodyHtml}</body></html>`);
    printWindow.document.close();

    setTimeout(() => {
      printWindow.print();
    }, 400);
  };

  return (
    <div className="relative">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-background/95 backdrop-blur border-b px-6 py-3">
        <h2 className="font-semibold text-foreground">{title}</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrint}
          className="gap-2"
          data-testid="button-download-pdf"
        >
          <Download className="h-4 w-4" />
          Download PDF
        </Button>
      </div>
      <div className="px-6 py-6 prose prose-slate dark:prose-invert max-w-none
        prose-headings:font-semibold prose-headings:tracking-tight
        prose-h1:text-2xl prose-h1:border-b prose-h1:border-border prose-h1:pb-3 prose-h1:mb-6
        prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-4
        prose-h3:text-base prose-h3:mt-6 prose-h3:mb-2
        prose-table:text-sm
        prose-th:bg-muted/50 prose-th:font-semibold
        prose-td:align-top
        prose-code:bg-muted prose-code:px-1 prose-code:rounded prose-code:text-sm prose-code:font-mono
        prose-blockquote:border-primary prose-blockquote:text-muted-foreground prose-blockquote:not-italic
        prose-a:text-primary prose-a:no-underline hover:prose-a:underline
        prose-li:my-0.5
      ">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function FAQItem({ faq }: { faq: FAQ }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="border rounded-lg overflow-hidden"
      data-testid={`faq-item-${faq.id}`}
    >
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(v => !v)}
        data-testid={`button-faq-toggle-${faq.id}`}
      >
        <span className="font-medium text-sm pr-4">{faq.question}</span>
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground border-t bg-muted/20 leading-relaxed">
          {faq.answer}
          <div className="flex flex-wrap gap-1 mt-3">
            {faq.tags.slice(0, 4).map(tag => (
              <Badge key={tag} variant="secondary" className="text-xs py-0">{tag}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KnowledgeBase() {
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const allTags = Array.from(
    new Set(kbData.faqs.flatMap((f: FAQ) => f.tags))
  ).sort();

  const filtered = kbData.faqs.filter((f: FAQ) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q) || f.tags.some(t => t.includes(q));
    const matchesTag = !activeTag || f.tags.includes(activeTag);
    return matchesSearch && matchesTag;
  });

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(kbData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "voltsafe-cortex-knowledge-base.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between bg-background/95 backdrop-blur border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-foreground">AI Knowledge Base</h2>
          <Badge variant="secondary">{kbData.faqs.length} Q&amp;As</Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportJson}
          className="gap-2"
          data-testid="button-export-knowledge-base"
        >
          <Download className="h-4 w-4" />
          Export JSON
        </Button>
      </div>

      <div className="px-6 py-4 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search questions, answers, or topics..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-kb-search"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant={!activeTag ? "default" : "outline"}
            className="cursor-pointer text-xs"
            onClick={() => setActiveTag(null)}
          >
            All topics
          </Badge>
          {allTags.slice(0, 30).map(tag => (
            <Badge
              key={tag}
              variant={activeTag === tag ? "default" : "outline"}
              className="cursor-pointer text-xs"
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              {tag}
            </Badge>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {kbData.faqs.length} questions
          {activeTag && <> · filtered by <strong>{activeTag}</strong></>}
        </p>

        <div className="space-y-2">
          {filtered.map((faq: FAQ) => (
            <FAQItem key={faq.id} faq={faq} />
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              <HelpCircle className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>No questions match your search.</p>
              <p className="text-xs mt-1">Try asking Cortex AI directly — it has access to all this knowledge.</p>
            </div>
          )}
        </div>

        <div className="pt-4 border-t">
          <h3 className="font-semibold text-sm mb-3">Glossary — {kbData.glossary.length} Terms</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {kbData.glossary.map((g: { term: string; definition: string }) => (
              <div key={g.term} className="text-sm border rounded-md px-3 py-2">
                <span className="font-medium text-foreground">{g.term}</span>
                <span className="text-muted-foreground"> — {g.definition}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HelpCenterPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b bg-background">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <BookOpen className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-none" data-testid="text-page-title">Help Center</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Documentation, training, and AI knowledge base</p>
        </div>
      </div>

      <Tabs defaultValue="quickstart" className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-6 bg-background">
          <TabsList className="h-10 bg-transparent p-0 gap-0 border-b-0">
            <TabsTrigger
              value="quickstart"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 h-10 text-sm gap-2"
              data-testid="tab-quickstart"
            >
              <Zap className="h-3.5 w-3.5" />
              Quick Start
            </TabsTrigger>
            <TabsTrigger
              value="manual"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 h-10 text-sm gap-2"
              data-testid="tab-manual"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Operations Manual
            </TabsTrigger>
            <TabsTrigger
              value="training"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 h-10 text-sm gap-2"
              data-testid="tab-training"
            >
              <GraduationCap className="h-3.5 w-3.5" />
              Training Handbook
            </TabsTrigger>
            <TabsTrigger
              value="kb"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 h-10 text-sm gap-2"
              data-testid="tab-kb"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              FAQ & Glossary
              <Badge variant="secondary" className="text-[10px] h-4 px-1">{kbData.faqs.length}</Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto">
          <TabsContent value="quickstart" className="mt-0 h-full">
            <MarkdownDoc content={quickStartRaw} title="Quick Start Guide" />
          </TabsContent>
          <TabsContent value="manual" className="mt-0 h-full">
            <MarkdownDoc content={opsManualRaw} title="Operations Manual" />
          </TabsContent>
          <TabsContent value="training" className="mt-0 h-full">
            <MarkdownDoc content={trainingRaw} title="Training Handbook" />
          </TabsContent>
          <TabsContent value="kb" className="mt-0 h-full">
            <KnowledgeBase />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
