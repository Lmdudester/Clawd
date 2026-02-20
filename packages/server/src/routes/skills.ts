import { Router } from 'express';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authMiddleware } from '../auth/middleware.js';
import type { SkillsResponse, SkillInfo } from '@clawd/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
// session-skills/ lives at the project root, 4 levels up from src/routes/
const SKILLS_DIR = join(__dirname, '../../../../session-skills');

export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let value = line.slice(idx + 1).trim();
    // Strip inline comments (only when not inside quotes)
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const commentIdx = value.indexOf(' #');
      if (commentIdx >= 0) {
        value = value.slice(0, commentIdx).trimEnd();
      }
    }
    // Strip surrounding quotes
    if (
      value.length >= 2 &&
      ((value[0] === '"' && value[value.length - 1] === '"') ||
        (value[0] === "'" && value[value.length - 1] === "'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

let cachedSkills: SkillInfo[] | null = null;

export function createSkillRoutes(): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/', async (_req, res) => {
    if (cachedSkills) {
      const response: SkillsResponse = { skills: cachedSkills };
      res.json(response);
      return;
    }

    try {
      const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
      const skills: SkillInfo[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillFile = join(SKILLS_DIR, entry.name, 'skill.md');
        try {
          const content = await readFile(skillFile, 'utf-8');
          const fm = parseFrontmatter(content);
          if (fm['user-invocable'] === 'true') {
            skills.push({
              name: fm.name || entry.name,
              description: fm.description || '',
            });
          }
        } catch {
          // skip directories without a valid skill.md
        }
      }

      cachedSkills = skills;
      const response: SkillsResponse = { skills };
      res.json(response);
    } catch {
      res.json({ skills: [] } satisfies SkillsResponse);
    }
  });

  return router;
}
