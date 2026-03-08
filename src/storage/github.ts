import { Octokit } from 'octokit';
import type { AiResult } from '../ai/processor';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = process.env.GITHUB_OWNER!;
const repo = process.env.GITHUB_REPO!;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export async function saveToGitHub(
  url: string,
  title: string,
  markdown: string,
  ai: AiResult,
  images: string[],
): Promise<string> {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const slug = slugify(title);
  const path = `notes/${yyyy}/${mm}/${dd}-${slug}.md`;

  const imagesSection = images.length > 0
    ? `\n\n## 圖片\n\n${images.map((img, i) => `![image-${i + 1}](${img})`).join('\n\n')}`
    : '';

  const frontMatter = `---
title: "${title.replace(/"/g, '\\"')}"
url: ${url}
summary: "${ai.summary.replace(/"/g, '\\"')}"
tags: [${ai.tags.map((t) => `"${t}"`).join(', ')}]
category: ${ai.category}
images: [${images.map((img) => `"${img}"`).join(', ')}]
saved_at: ${now.toISOString()}
---

${markdown}${imagesSection}`;

  const response = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: `Add: ${title.slice(0, 60)}`,
    content: Buffer.from(frontMatter).toString('base64'),
  });

  return response.data.content?.html_url || `https://github.com/${owner}/${repo}/blob/main/${path}`;
}
