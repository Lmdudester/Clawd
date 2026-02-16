import { Router } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import type { CreateBranchRequest, ErrorResponse } from '@clawd/shared';

function parseOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
  // Handles https://github.com/owner/repo, https://github.com/owner/repo.git, etc.
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function githubApi(path: string, options: RequestInit = {}): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');

  return fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

export function createRepoRoutes(): Router {
  const router = Router();
  router.use(authMiddleware);

  // List branches for a repo
  router.get('/branches', async (req, res) => {
    const repoUrl = req.query.repoUrl as string;
    if (!repoUrl) {
      const error: ErrorResponse = { error: 'repoUrl query parameter is required' };
      res.status(400).json(error);
      return;
    }

    const parsed = parseOwnerRepo(repoUrl);
    if (!parsed) {
      const error: ErrorResponse = { error: 'Invalid GitHub repository URL' };
      res.status(400).json(error);
      return;
    }

    try {
      const ghRes = await githubApi(`/repos/${parsed.owner}/${parsed.repo}/branches?per_page=100`);
      if (!ghRes.ok) {
        const body = await ghRes.json().catch(() => ({}));
        res.status(ghRes.status).json({ error: (body as any).message || 'Failed to fetch branches' });
        return;
      }

      const data = (await ghRes.json()) as { name: string }[];
      const branches = data.map((b) => b.name).sort((a, b) => a.localeCompare(b));
      res.json({ branches });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch branches' });
    }
  });

  // Create a new branch
  router.post('/branches', async (req, res) => {
    const { repoUrl, branchName, fromBranch } = req.body as CreateBranchRequest;

    if (!repoUrl || !branchName) {
      const error: ErrorResponse = { error: 'repoUrl and branchName are required' };
      res.status(400).json(error);
      return;
    }

    const parsed = parseOwnerRepo(repoUrl);
    if (!parsed) {
      const error: ErrorResponse = { error: 'Invalid GitHub repository URL' };
      res.status(400).json(error);
      return;
    }

    try {
      // Get the SHA of the source branch
      const sourceBranch = fromBranch || 'main';
      const refRes = await githubApi(`/repos/${parsed.owner}/${parsed.repo}/git/ref/heads/${sourceBranch}`);
      if (!refRes.ok) {
        const body = await refRes.json().catch(() => ({}));
        res.status(refRes.status).json({ error: (body as any).message || `Branch "${sourceBranch}" not found` });
        return;
      }

      const refData = (await refRes.json()) as { object: { sha: string } };
      const sha = refData.object.sha;

      // Create the new branch
      const createRes = await githubApi(`/repos/${parsed.owner}/${parsed.repo}/git/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
      });

      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}));
        res.status(createRes.status).json({ error: (body as any).message || 'Failed to create branch' });
        return;
      }

      res.status(201).json({ branch: branchName });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to create branch' });
    }
  });

  return router;
}
