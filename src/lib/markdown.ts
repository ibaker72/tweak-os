/**
 * Tiny dependency-free markdown -> HTML renderer for proposals and drafts.
 * Supports: ## / ### headings, bold, italic, links, unordered + numbered lists,
 * pipe-delimited tables, and paragraphs. Output is sanitized by escaping any
 * HTML in the source before applying inline transforms.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyInline(s: string): string {
  return s
    .replace(
      /\*\*([^*]+)\*\*/g,
      '<strong class="font-semibold text-zinc-100">$1</strong>'
    )
    .replace(/\*([^*]+)\*/g, '<em class="italic">$1</em>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-zinc-800 px-1 py-0.5 text-xs text-lime-300">$1</code>')
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="text-lime-400 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}

function renderTable(rows: string[]): string {
  // rows[0] = header, rows[1] = separator (--- ---), rows[2..] = body
  if (rows.length < 2) return rows.map((r) => `<p>${applyInline(r)}</p>`).join("");
  const headerCells = splitRow(rows[0]);
  const bodyRows = rows.slice(2).map(splitRow);

  const head = `<thead><tr>${headerCells
    .map(
      (c) =>
        `<th class="border-b border-zinc-700 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400">${applyInline(c)}</th>`
    )
    .join("")}</tr></thead>`;
  const body = `<tbody>${bodyRows
    .map(
      (cells) =>
        `<tr class="border-b border-zinc-800/60">${cells
          .map(
            (c) =>
              `<td class="px-3 py-2 text-sm text-zinc-200">${applyInline(c)}</td>`
          )
          .join("")}</tr>`
    )
    .join("")}</tbody>`;
  return `<div class="my-4 overflow-x-auto rounded-lg border border-zinc-800"><table class="w-full">${head}${body}</table></div>`;
}

function splitRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\||\|$/g, "");
  return trimmed.split("|").map((c) => c.trim());
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:-]+\|[\s:|-]+\|?\s*$/.test(line);
}

export function renderMarkdown(input: string): string {
  // Escape any raw HTML first, then walk lines.
  const safe = escapeHtml(input);
  const lines = safe.split(/\r?\n/);
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Tables
    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const tableRows: string[] = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        tableRows.push(lines[i]);
        i++;
      }
      out.push(renderTable(tableRows));
      continue;
    }

    // Headings
    let h = /^### (.*)$/.exec(line);
    if (h) {
      out.push(
        `<h3 class="mt-5 mb-2 text-base font-semibold text-zinc-100">${applyInline(h[1])}</h3>`
      );
      i++;
      continue;
    }
    h = /^## (.*)$/.exec(line);
    if (h) {
      out.push(
        `<h2 class="mt-6 mb-3 border-b border-zinc-800 pb-2 text-lg font-bold text-lime-400">${applyInline(h[1])}</h2>`
      );
      i++;
      continue;
    }
    h = /^# (.*)$/.exec(line);
    if (h) {
      out.push(
        `<h1 class="mt-6 mb-3 text-xl font-bold text-zinc-100">${applyInline(h[1])}</h1>`
      );
      i++;
      continue;
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      out.push(
        `<ol class="my-3 ml-5 list-decimal space-y-1.5 text-sm text-zinc-200">${items
          .map((it) => `<li>${applyInline(it)}</li>`)
          .join("")}</ol>`
      );
      continue;
    }

    // Bulleted list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push(
        `<ul class="my-3 ml-5 list-disc space-y-1.5 text-sm text-zinc-200">${items
          .map((it) => `<li>${applyInline(it)}</li>`)
          .join("")}</ul>`
      );
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph (greedy across consecutive non-blank lines)
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3} |[-*]\s+|\d+\.\s+)/.test(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(
      `<p class="my-3 text-sm leading-relaxed text-zinc-200">${applyInline(
        para.join(" ")
      )}</p>`
    );
  }

  return out.join("\n");
}
