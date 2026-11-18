/** What `ouijit ask run` asks the user to run on the host, resolved before the user sees it. */
export interface AskRun {
  command: string;
  /** The project script it names, if it named one. */
  scriptName?: string;
  cwd: string;
  /** A script the command runs that the agent could have written, as the user is shown it. */
  file?: {
    path: string;
    /** As much of it as is shown: all of it, unless it is `cut`. */
    contents: string;
    size: number;
    /** Longer than is shown. */
    cut?: boolean;
    /** Not text, so nothing of it is shown. */
    binary?: boolean;
    /** Too large to copy, so the file itself runs, and can change after it is read. */
    uncopied?: boolean;
  };
  /** The command as it runs: `command` with that script swapped for a copy the agent cannot change. */
  runCommand?: string;
  /** Answer once the run ends, rather than once it is asked. */
  wait?: boolean;
}
