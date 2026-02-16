// Schema for optional .clawd.yml configuration file at the root of a git repo.
// The session agent reads this after cloning to configure the workspace.

export interface ClawdConfig {
  /** Commands to run after clone (dependency install, build, etc.) */
  setup?: string[];
  /** Extra environment variables for the Claude SDK process */
  env?: Record<string, string>;
  /** Additional MCP servers beyond the defaults (playwright is always included) */
  mcp?: Record<string, { command: string; args?: string[] }>;
  /** Custom system prompt addition (appended to the default claude_code preset) */
  systemPrompt?: string;
}
