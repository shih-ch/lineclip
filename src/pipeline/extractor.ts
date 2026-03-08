import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export interface Article {
  title: string;
  content: string;
  images: string[];
}

export function extractArticle(html: string, url: string): Article | null {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // Extract all image URLs before Readability modifies the DOM
  const images: string[] = [];
  const seen = new Set<string>();
  for (const img of doc.querySelectorAll('img[src]')) {
    try {
      const src = new URL(img.getAttribute('src')!, url).href;
      // Skip tiny tracking pixels and data URIs
      if (src.startsWith('data:')) continue;
      const w = parseInt(img.getAttribute('width') || '0', 10);
      const h = parseInt(img.getAttribute('height') || '0', 10);
      if (w > 0 && w < 3 && h > 0 && h < 3) continue;
      if (!seen.has(src)) {
        seen.add(src);
        images.push(src);
      }
    } catch { /* invalid URL, skip */ }
  }

  // Also grab og:image
  const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
  if (ogImage) {
    try {
      const ogSrc = new URL(ogImage, url).href;
      if (!seen.has(ogSrc)) {
        images.unshift(ogSrc);
      }
    } catch { /* skip */ }
  }

  const article = new Readability(doc).parse();
  if (!article || !article.title || !article.content) return null;

  return { title: article.title, content: article.content, images };
}
