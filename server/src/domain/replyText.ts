// Turning a raw email reply into just the new text the customer wrote.

const QUOTE_HEADERS = [
  /^On .+wrote:\s*$/m, // Gmail / Apple Mail, one line
  /^On .+\n.*wrote:\s*$/m, // Gmail wraps long "On ... <address> wrote:" lines
  /^-{2,}\s*Original Message\s*-{2,}/im, // Outlook
  /^_{5,}\s*$\n^From: /m, // Outlook web
  /^From: .+\n^(Sent|Date): /m, // forwarded/quoted header block
];

/** Removes quoted history: every line starting with ">" and everything from an "On … wrote:" header on. */
export function stripQuoted(text: string): string {
  let t = text.replace(/\r\n/g, '\n');
  let cut = t.length;
  for (const re of QUOTE_HEADERS) {
    const m = re.exec(t);
    if (m && m.index < cut) cut = m.index;
  }
  t = t.slice(0, cut);
  return t
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Very small HTML → text fallback for messages without a text/plain part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, '\n')
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** The bare address from a From header: `"Dawit" <a@b.com>` → `a@b.com`. */
export function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}
