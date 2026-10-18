/** Text as it should be heard: no Markdown, no list markers, no links. */
export function forSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*([-*•]|\d+[.)])\s+/gm, '')
    .replace(/[*_#>`]/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ', ')
    .replace(/\s+([.,])/g, '$1')
    .trim()
    .slice(0, 2000);
}

