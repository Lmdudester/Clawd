import { readFileSync, writeFileSync } from 'fs';
import type { ProjectRepo } from '@clawd/shared';
import { config } from '../config.js';

export class ProjectRepoStore {
  private repos: ProjectRepo[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(config.projectReposPath, 'utf-8');
      const data = JSON.parse(raw);
      // Support both old "folders" format and new "repos" format
      this.repos = Array.isArray(data.repos)
        ? data.repos
        : Array.isArray(data.folders)
          ? data.folders.map(this.migrateFolder)
          : [];
    } catch {
      this.repos = [];
    }
  }

  private migrateFolder(folder: any): ProjectRepo {
    // Migrate old ProjectFolder { path, label, isDefault } to ProjectRepo
    return {
      url: folder.url || folder.path || '',
      label: folder.label || '',
      defaultBranch: folder.defaultBranch || 'main',
      isDefault: folder.isDefault || false,
    };
  }

  private save(): void {
    writeFileSync(config.projectReposPath, JSON.stringify({ repos: this.repos }, null, 2));
  }

  getRepos(): ProjectRepo[] {
    return this.repos;
  }

  setRepos(repos: ProjectRepo[]): void {
    this.repos = repos;
    this.save();
  }
}
