import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { ProjectFolder } from '@clawd/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../../../..');
const storagePath = resolve(projectRoot, 'project-folders.json');

export class ProjectFolderStore {
  private folders: ProjectFolder[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(storagePath, 'utf-8');
      const data = JSON.parse(raw);
      this.folders = Array.isArray(data.folders) ? data.folders : [];
    } catch {
      this.folders = [];
    }
  }

  private save(): void {
    writeFileSync(storagePath, JSON.stringify({ folders: this.folders }, null, 2));
  }

  getFolders(): ProjectFolder[] {
    return this.folders;
  }

  setFolders(folders: ProjectFolder[]): void {
    this.folders = folders;
    this.save();
  }
}
