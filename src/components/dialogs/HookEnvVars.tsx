import { useState, useCallback } from 'react';

/** Variables Ouijit sets in the hook's shell. */
const ENV_VARS = [
  '$OUIJIT_PROJECT_PATH',
  '$OUIJIT_WORKTREE_PATH',
  '$OUIJIT_TASK_BRANCH',
  '$OUIJIT_TASK_NAME',
  '$OUIJIT_TASK_DESCRIPTION',
];

/**
 * The "Environment variables" disclosure shared by the hook dialogs. Explains
 * what the variables are, lists them, and copies one to the clipboard on click.
 */
export function HookEnvVars() {
  const [copiedVar, setCopiedVar] = useState<string | null>(null);

  const copyVar = useCallback((varName: string) => {
    navigator.clipboard.writeText(varName);
    setCopiedVar(varName);
    setTimeout(() => setCopiedVar(null), 1500);
  }, []);

  return (
    <details className="mt-3 text-xs text-text-secondary [&>summary]:cursor-default [&>summary]:select-none [&_ul]:mt-2 [&_ul]:mb-0 [&_ul]:pl-5 [&_li]:my-1">
      <summary>Environment variables</summary>
      <p className="mt-2 mb-0 text-text-tertiary leading-snug">
        Ouijit sets these in the hook&apos;s shell. Reference one in your command, or click to copy.
      </p>
      <ul>
        {ENV_VARS.map((v) => (
          <li key={v}>
            <code
              className={`font-mono text-[13px] px-1.5 py-0.5 rounded inline-block bg-background-secondary hover:text-text-primary hover:bg-border-hover ${copiedVar === v ? 'text-accent !bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)]' : ''}`}
              style={{ transition: 'background 100ms ease, color 100ms ease' }}
              onClick={() => copyVar(v)}
            >
              {copiedVar === v ? 'Copied!' : v}
            </code>
          </li>
        ))}
      </ul>
    </details>
  );
}
