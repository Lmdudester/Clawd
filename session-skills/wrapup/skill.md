---
name: wrapup
description: Review, commit, and push your work after making code changes
user-invocable: true
---

# Wrapup Skill

Use this skill when you have finished code changes and need to review, commit, and push your work.

## Instructions

Follow these steps in order:

### 1. Review Changes

Run `git status` and `git diff` to understand all changes made since the last commit. Summarize what was changed and why.

**Important:** If you edited files that don't appear in `git status`, check if they are gitignored before investigating further. Use `git check-ignore <file>` to verify.

### 2. Check Documentation

Review the changes and determine if any documentation needs updating:
- README.md - if user-facing features or setup changed
- CLAUDE.md - if development guidelines or project structure changed
- Code comments - if complex logic was added
- API docs - if endpoints or interfaces changed

If documentation updates are needed, make them before committing.

### 3. Clean Up Temporary Files

Check `git status` for untracked files that were created during testing or debugging (e.g., screenshots, stack dumps, snapshots, log files, temporary scripts). List any found and delete them before committing. Common examples:
- `.png` screenshots or captures
- `.stackdump` files
- Temporary markdown/text files used for notes or snapshots
- Test output files or scratch scripts
- Tool-generated directories (e.g., `.playwright-mcp/`)

If unsure whether a file is temporary, ask the user before deleting.

### 4. Commit Changes

Create a meaningful commit:
- Use `git status` to see what needs to be staged
- Stage relevant files (prefer specific files over `git add -A`)
- Write a clear commit message that explains the "why" not just the "what"
- End the commit message with: `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>`

### 5. Push to Remote

- Determine the current branch with `git branch --show-current`
- Push to the current branch (whether it's main or a feature branch)
- Use `git push -u origin <branch>` if the branch hasn't been pushed before
- Report the result to the user

## Important Notes

- Never force push unless explicitly requested
- Never skip pre-commit hooks
- If pre-commit hooks fail, fix the issues and create a NEW commit (don't amend)
- Ask the user if anything is unclear about what should be included in the commit
- Before committing, verify all edited files appear in `git status` - if a file is missing, it may be gitignored and should not be committed
