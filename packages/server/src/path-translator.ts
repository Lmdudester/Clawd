import { config } from './config.js';

// Derive the base mount path from the configured prefix.
// e.g. "/host/c" → "/host" so we can map any drive letter as "/host/{letter}/..."
function driveBase(): string {
  const prefix = config.hostDrivePrefix;
  const lastSlash = prefix.lastIndexOf('/');
  return lastSlash > 0 ? prefix.slice(0, lastSlash) : prefix;
}

// Translate Windows paths (C:\Users\...) to container paths (/host/c/Users/...)
export function windowsToContainer(windowsPath: string): string {
  if (!config.hostDrivePrefix) return windowsPath;

  // Match any drive letter (A-Z) followed by :\ or :/
  const match = windowsPath.match(/^([a-zA-Z]):[\\\/](.*)/);
  if (!match) return windowsPath;

  const [, driveLetter, rest] = match;
  const unixPath = rest.replace(/\\/g, '/');
  return `${driveBase()}/${driveLetter.toLowerCase()}/${unixPath}`;
}

// Translate container paths (/host/c/Users/...) back to Windows paths (C:\Users\...)
export function containerToWindows(containerPath: string): string {
  if (!config.hostDrivePrefix) return containerPath;

  const base = driveBase();
  // Match base + / + single drive letter + /
  const re = new RegExp(`^${escapeRegExp(base)}/([a-z])/(.*)`);
  const match = containerPath.match(re);
  if (match) {
    const [, driveLetter, rest] = match;
    return `${driveLetter.toUpperCase()}:\\${rest.replace(/\//g, '\\')}`;
  }
  return containerPath;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
