import { CodePreview } from '../common/CodePreview';
import { languageOf } from '../../utils/syntaxHighlight';
import { homeRelative } from '../sidebar/SidebarRows';
import type { AskRun } from '../../types';

type ScriptFile = NonNullable<AskRun['file']>;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The ways a script falls short of being read in full before it runs, as the queue marks them. */
export function scriptRisks(file: ScriptFile | undefined): string[] {
  if (!file) return [];
  return [
    ...(file.cut || file.binary ? ['Script not shown in full'] : []),
    ...(file.uncopied ? ['Script can change after you read it'] : []),
  ];
}

/** The script an ask runs, as much of it as can be shown, and what of it cannot. */
export function ScriptPreview({ file, maxHeight }: { file: ScriptFile; maxHeight: string }) {
  const notes = [
    file.binary && `${homeRelative(file.path)} is a binary file, ${size(file.size)}, so none of it can be shown.`,
    file.cut && `Showing the first 32 KB of ${size(file.size)}.`,
    file.uncopied && 'Too large to copy, so the file itself runs, and can change after you read it.',
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-1">
      {!file.binary && (
        <CodePreview
          testId="ask-file"
          code={file.contents}
          lang={languageOf(file.path, file.contents)}
          path={homeRelative(file.path)}
          maxHeight={maxHeight}
        />
      )}
      {notes.map((note) => (
        <p key={note as string} className="m-0 text-[11px] text-text-tertiary">
          {note}
        </p>
      ))}
    </div>
  );
}
