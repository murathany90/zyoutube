export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function renderSimpleMarkdown(text: string): string {
  if (!text) return '';

  // Normalize line endings
  let input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Escape HTML first to prevent XSS
  input = input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Process line by line for block-level elements
  const lines = input.split('\n');
  const outputLines: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' | '' = '';

  const closeList = () => {
    if (inList) {
      outputLines.push(listType === 'ol' ? '</ol>' : '</ul>');
      inList = false;
      listType = '';
    }
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Code blocks (```...```) — multi-line support handled by joining
    if (line.trim().startsWith('```')) {
      closeList();
      // Find closing ```
      let codeContent = '';
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeContent += (codeContent ? '\n' : '') + lines[i];
        i++;
      }
      outputLines.push(`<pre class="zy-code-block">${codeContent}</pre>`);
      continue;
    }

    // Headers
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) { closeList(); outputLines.push(`<h4 class="zy-heading zy-h4">${applyInline(h3Match[1])}</h4>`); continue; }
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) { closeList(); outputLines.push(`<h3 class="zy-heading zy-h3">${applyInline(h2Match[1])}</h3>`); continue; }
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) { closeList(); outputLines.push(`<h2 class="zy-heading zy-h2">${applyInline(h1Match[1])}</h2>`); continue; }

    // Horizontal rule
    if (/^(---|\*\*\*|___)\s*$/.test(line.trim())) { closeList(); outputLines.push('<hr class="zy-hr" />'); continue; }

    // Unordered list item (- item or * item, but not ** bold **)
    const ulMatch = line.match(/^\s*[-]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') { closeList(); outputLines.push('<ul class="zy-ul">'); inList = true; listType = 'ul'; }
      outputLines.push(`<li class="zy-li">${applyInline(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered list item (1. item)
    const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') { closeList(); outputLines.push('<ol class="zy-ol">'); inList = true; listType = 'ol'; }
      outputLines.push(`<li class="zy-li">${applyInline(olMatch[1])}</li>`);
      continue;
    }

    // Empty line — paragraph break
    if (line.trim() === '') {
      closeList();
      outputLines.push('<div class="zy-spacer"></div>');
      continue;
    }

    // Regular text line
    closeList();
    outputLines.push(`<div class="zy-line">${applyInline(line)}</div>`);
  }

  closeList();
  return outputLines.join('');
}

/** Apply inline formatting (bold, italic, inline code) */
function applyInline(text: string): string {
  // Zaman damgalarını (Örn: [0:00], 15:19, 1:23:45) tıklanabilir bağlantılara çevir
  text = text.replace(/\[?\b(\d{1,2}:\d{2}(?::\d{2})?)\b\]?/g, '<span class="zy-timestamp-link" data-time="$1" style="color: #3b82f6; cursor: pointer; text-decoration: underline; font-weight: 600;">$&</span>');

  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code class="zy-inline-code">$1</code>');
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic (single * not preceded/followed by space — avoid matching list markers)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  return text;
}
