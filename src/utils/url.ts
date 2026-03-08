const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

export function extractUrls(text: string): string[] {
  return text.match(URL_REGEX) || [];
}
