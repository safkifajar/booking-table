/**
 * Renderer Markdown minimal (tanpa dependency) untuk dokumen legal.
 * Mendukung: heading (#..###), bold **x**, italic *x*, list (- / 1.), link
 * [t](url), garis horizontal ---, dan paragraf. Input di-escape dulu (anti-XSS),
 * baru pola Markdown diubah ke tag aman.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary underline">$1</a>'
    );
}

function toHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    // Heading
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      const lvl = h[1].length;
      const cls =
        lvl === 1
          ? "text-xl font-bold mt-6 mb-2"
          : lvl === 2
            ? "text-lg font-semibold mt-5 mb-2"
            : "text-base font-semibold mt-4 mb-1.5";
      out.push(`<h${lvl} class="${cls}">${inline(h[2])}</h${lvl}>`);
      continue;
    }
    // Horizontal rule
    if (/^---+$/.test(line)) {
      flushPara();
      closeList();
      out.push('<hr class="my-4 border-border" />');
      continue;
    }
    // Unordered list
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      if (listType !== "ul") {
        closeList();
        out.push('<ul class="list-disc pl-5 space-y-1 my-2">');
        listType = "ul";
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    // Ordered list
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      if (listType !== "ol") {
        closeList();
        out.push('<ol class="list-decimal pl-5 space-y-1 my-2">');
        listType = "ol";
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    // Paragraph line
    closeList();
    para.push(line.trim());
  }
  flushPara();
  closeList();
  return out.join("\n");
}

export function MarkdownView({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  if (!content.trim()) {
    return (
      <p className="text-sm text-muted-foreground">No content yet.</p>
    );
  }
  return (
    <div
      className={
        "text-sm leading-relaxed text-foreground/90 " + (className ?? "")
      }
      dangerouslySetInnerHTML={{ __html: toHtml(content) }}
    />
  );
}
