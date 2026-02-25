# Focused Manager Mode

## Context

The manager currently has two modes: explore-then-fix (discovers issues via exploration sessions and GitHub issues) and skip-exploration (triages existing GitHub issues). Both rely on the manager discovering what to work on. Users want a third mode where they specify a concrete task upfront and the manager uses the same plan → review → fix → test → merge pipeline to implement it automatically — no exploration, no triage.

## Approach

Add "Focused Task" as a 4th option in the existing onboarding Focus question. When selected, a follow-up question captures the task description. The manager then skips Steps 1–2 entirely and begins at Step 3 (Plan) with the task as a single issue group.

## Files to Modify

### 1. `packages/shared/src/session.ts` — Add `focusedTask` field

Add `focusedTask?: string` to `ManagerPreferences`:

```typescript
export interface ManagerPreferences {
  focus: ManagerFocus;
  skipExploration: boolean;
  requirePlanApproval: boolean;
  focusedTask?: string;  // NEW — when set, skip explore+triage, go straight to planning
}
```

### 2. `packages/server/src/sessions/session-manager.ts` — Onboarding + initial message

#### `showManagerOnboarding()` (~line 1022)

Add "Focused Task" as a 4th option in the Focus question, and add a new question for the task description:

```typescript
questions: [
  {
    question: 'What should the manager focus on?',
    header: 'Focus',
    options: [
      { label: 'Bugs', description: 'Find and fix bugs only' },
      { label: 'Enhancements', description: 'Find and implement enhancements only' },
      { label: 'Both', description: 'Find and address both bugs and enhancements' },
      { label: 'Focused Task', description: 'Implement a specific task you describe — skips exploration and triage' },
    ],
    multiSelect: false,
  },
  {
    question: 'Describe the task for the manager to implement:',
    header: 'Task',
    options: [],  // empty options = custom text input only
    multiSelect: false,
  },
  // ... existing exploration + plan approval questions unchanged
]
```

#### `handleManagerOnboardingAnswer()` (~line 1075)

Parse the new answers. When "Focused Task" is selected, read the task description from `customInputs`, set `focusedTask` on preferences, force `skipExploration: true`:

```typescript
const focusAnswer = answers['What should the manager focus on?'] ?? 'Both';
const isFocusedTask = focusAnswer.toLowerCase().includes('focused');
const taskDescription = answers['Describe the task for the manager to implement:'] ?? '';

const focus: ManagerFocus = isFocusedTask ? 'both' :
  focusAnswer.toLowerCase().includes('bug') ? 'bugs' :
  focusAnswer.toLowerCase().includes('enhancement') ? 'enhancements' : 'both';

const focusedTask = isFocusedTask && taskDescription.trim() ? taskDescription.trim() : undefined;
const skipExploration = focusedTask ? true : explorationAnswer.toLowerCase().includes('skip');

const preferences: ManagerPreferences = { focus, skipExploration, requirePlanApproval, focusedTask };
```

Update the system message to reflect focused task mode:

```typescript
content: focusedTask
  ? `Manager configured: mode=focused task, plan approval=${requirePlanApproval ? 'required' : 'auto'}`
  : `Manager configured: focus=${focus}, exploration=${skipExploration ? 'skip' : 'enabled'}, plan approval=${requirePlanApproval ? 'required' : 'auto'}`,
```

#### `buildManagerInitialMessage()` (~line 1113)

Add a focused task branch that skips directly to Step 3:

```typescript
private buildManagerInitialMessage(preferences: ManagerPreferences): string {
  const { focus, skipExploration, requirePlanApproval, focusedTask } = preferences;

  const planApprovalNote = requirePlanApproval
    ? ' Plan approval is REQUIRED — after planning and review, STOP and wait for user feedback on each plan before proceeding to fixing.'
    : ' Plan approval is NOT required — after plans pass review, proceed to fixing automatically.';

  // Focused task mode — skip explore + triage, go straight to planning
  if (focusedTask) {
    return `Begin your independent manager loop in FOCUSED TASK mode. Skip exploration and triage — go directly to Step 3 (Plan). Your task is:\n\n${focusedTask}\n\nTreat this as a single issue group. Create one branch, plan the implementation, then proceed through review → fix → test → merge as normal.${planApprovalNote}`;
  }

  // ... existing explore/skip logic unchanged
}
```

#### `scheduleManagerContinue()` (~line 1011)

Update `focusReminder` to include focused task context:

```typescript
const prefs = s.managerState?.preferences;
const focusReminder = prefs?.focusedTask
  ? ` Remember: you are implementing a focused task: "${prefs.focusedTask}".`
  : prefs
    ? ` Remember: focus on ${prefs.focus === 'bugs' ? 'bugs only' : prefs.focus === 'enhancements' ? 'enhancements only' : 'both bugs and enhancements'}.`
    : '';
```

### 3. `packages/session-agent/src/manager-prompt.ts` — Strengthen initial message instruction

Update the `**Important:**` paragraph (~line 61) to acknowledge focused task mode:

```
**Important:** Follow the instructions in your initial message regarding what to do. If instructed to skip exploration, begin at Step 2 instead of Step 1. If given a focused task, begin at Step 3 (Plan) — treat the task description as a single issue group: create one branch, plan the implementation, then proceed through review → fix → test → merge. Always scope child session instructions to match the specified focus or task.
```

### 4. No changes needed to:

- `packages/shared/src/api.ts` — focused task is configured via onboarding, not session creation
- `packages/client/src/components/sessions/NewSessionDialog.tsx` — unchanged
- `packages/client/src/components/input/QuestionPanel.tsx` — already renders a custom text input for each question, and handles `options: []` correctly (just shows the text input with no buttons)
- `packages/client/src/components/sessions/SessionCard.tsx` — step badges already cover planning/reviewing/fixing/testing/merging
- `packages/session-agent/src/sdk-runner.ts` — no new env vars needed

## Verification

1. **Build**: Run `npm run build` from workspace root to verify TypeScript compiles
2. **Manual test**: Create a manager session, verify 4 onboarding questions appear (Focus with "Focused Task" option, Task description, Exploration, Plan approval)
3. **Select "Focused Task"**, type a task description, submit. Verify:
   - System message shows `mode=focused task`
   - Initial message sent to manager contains the task description and "Skip exploration and triage"
   - Manager begins at Step 3 (planning) — creates a branch and planning session
4. **Verify existing modes still work**: Create a manager with "Bugs" focus, verify it still shows the normal explore/triage flow
5. **Edge case**: Select "Focused Task" but leave description blank — verify it falls back to normal mode (both focus, not focused task)
