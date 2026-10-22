import { useProjectConfig } from '../../stores/projectDataStore';
import { SANDBOX_BACKEND_IDS, SANDBOX_LABELS, type SandboxProviderId } from '../../types';
import { SegmentedGroup, segmentAccent, segmentBase, segmentQuiet } from './SegmentedGroup';

/**
 * Host plus each backend that can run. A chosen backend stays listed after it
 * stops being available, so the choice is visible rather than silently
 * becoming Host.
 */
export function useSandboxOptions(projectPath: string, value: SandboxProviderId | undefined): SandboxProviderId[] {
  const available = useProjectConfig(projectPath)?.availableSandboxProviders ?? [];
  return ['none', ...SANDBOX_BACKEND_IDS.filter((id) => available.includes(id) || id === value)];
}

interface Segment<T> {
  value: T;
  label: string;
}

function Segments<T>({
  segments,
  value,
  onChange,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-text-secondary">Sandbox</span>
      <SegmentedGroup>
        {segments.map((segment) => (
          <button
            key={segment.label}
            type="button"
            aria-pressed={value === segment.value}
            className={`${segmentBase} ${value === segment.value ? segmentAccent : segmentQuiet}`}
            onClick={() => onChange(segment.value)}
          >
            {segment.label}
          </button>
        ))}
      </SegmentedGroup>
    </div>
  );
}

/** Where one run goes, with the project default listed first and named as such. */
export function SandboxPicker({
  projectPath,
  value,
  onChange,
}: {
  projectPath: string;
  value: SandboxProviderId;
  onChange: (value: SandboxProviderId) => void;
}) {
  const options = useSandboxOptions(projectPath, value);
  const projectDefault = useProjectConfig(projectPath)?.defaultSandbox ?? 'none';
  if (options.length === 1) return null;
  const ordered = [projectDefault, ...options.filter((id) => id !== projectDefault)];
  const segments = ordered.map((id) => ({
    value: id,
    label: id === projectDefault ? `Default (${SANDBOX_LABELS[id]})` : SANDBOX_LABELS[id],
  }));
  return <Segments segments={segments} value={value} onChange={onChange} />;
}

/** Where a hook always runs; undefined follows the project default. */
export function HookSandboxPicker({
  projectPath,
  value,
  onChange,
}: {
  projectPath: string;
  value: SandboxProviderId | undefined;
  onChange: (value: SandboxProviderId | undefined) => void;
}) {
  const options = useSandboxOptions(projectPath, value);
  if (options.length === 1) return null;
  const segments: Segment<SandboxProviderId | undefined>[] = [
    { value: undefined, label: 'Default' },
    ...options.map((id) => ({ value: id, label: SANDBOX_LABELS[id] })),
  ];
  return <Segments segments={segments} value={value} onChange={onChange} />;
}
