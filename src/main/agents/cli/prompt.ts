import type { Project, Task } from '@shared/types'

/** The instructions every coding agent receives for a task. Kept provider-neutral on purpose. */
export function buildTaskPrompt(task: Task, project: Project): string {
  const lines = [
    `You are working on the project "${project.name}".`,
    'The current directory is an isolated git worktree of the project created for this task.',
    '',
    '## Task',
    task.title,
  ]
  if (task.description.trim()) lines.push('', task.description.trim())
  lines.push(
    '',
    '## Rules',
    '- Make the code changes needed to complete the task, editing files in the current directory only.',
    '- Do not commit, push, create branches or change git configuration: Forge collects the diff itself.',
    project.testCommand
      ? `- After you finish, Forge runs \`${project.testCommand}\` and shows the result to a human reviewer.`
      : '- A human reviews the diff before anything is merged.',
    '- Keep the change focused on the task. When done, reply with a short summary of what you changed.'
  )
  if (project.description.trim()) lines.push('', '## About the project', project.description.trim())
  return lines.join('\n')
}
