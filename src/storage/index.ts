import { saveToNotion } from './notion';
import { saveToGitHub } from './github';
import type { AiResult } from '../ai/processor';

export async function save(
  url: string,
  title: string,
  markdown: string,
  ai: AiResult,
  images: string[],
): Promise<{ pageUrl: string; storage: string }> {
  const storage = process.env.DEFAULT_STORAGE || 'notion';

  if (storage === 'github') {
    const pageUrl = await saveToGitHub(url, title, markdown, ai, images);
    return { pageUrl, storage: 'GitHub' };
  }

  const pageUrl = await saveToNotion(url, title, markdown, ai, images);
  return { pageUrl, storage: 'Notion' };
}
