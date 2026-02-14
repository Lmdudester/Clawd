import { config } from './config.js';

// Translate Windows paths (C:\Users\...) to container paths (/host/c/Users/...)
export function windowsToContainer(windowsPath: string): string {
  if (!config.hostDrivePrefix) return windowsPath;

  // Match C:\ or C:/ (case-insensitive)
  const match = windowsPath.match(/^([a-zA-Z]):[\\\/](.*)/);
  if (!match) return windowsPath;

  const [, driveLetter, rest] = match;
  const unixPath = rest.replace(/\\/g, '/');
  return `${config.hostDrivePrefix}/${unixPath}`;
}

// Translate container paths (/host/c/Users/...) back to Windows paths (C:\Users\...)
export function containerToWindows(containerPath: string): string {
  if (!config.hostDrivePrefix) return containerPath;

  if (containerPath.startsWith(config.hostDrivePrefix + '/')) {
    const rest = containerPath.slice(config.hostDrivePrefix.length + 1);
    return `C:\\${rest.replace(/\//g, '\\')}`;
  }
  return containerPath;
}
