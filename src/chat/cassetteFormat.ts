/** One recorded agent process: its stdio, line by line, as a cassette file holds it. */
export interface CassetteEntry {
  dir: 'in' | 'out';
  line: string;
  /** Milliseconds since the process was spawned, so a replay can keep the agent's pace. */
  t?: number;
}

export interface Cassette {
  agent: string;
  version?: string;
  entries: CassetteEntry[];
  /** How the agent exited by itself, as a one-shot does; absent for one that ran until it was stopped. */
  exit?: number;
}
