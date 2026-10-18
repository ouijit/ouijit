import { useProjectConfig } from '../../stores/projectDataStore';
import { SANDBOX_BACKEND_IDS, SANDBOX_BACKEND_LABELS, type SandboxProviderId } from '../../types';
import { SegmentedGroup, segmentAccent, segmentBase, segmentQuiet } from './SegmentedGroup';

interface SandboxPickerProps {
  projectPath: string;
  value: SandboxProviderId;
  onChange: (value: SandboxProviderId) => void;
}

/**
 * Host plus each backend that can run. A chosen backend stays listed after it
 * stops being available, so the choice is visible rather than silently
 * becoming Host.
 */
export function useSandboxOptions(projectPath: string, value: SandboxProviderId): SandboxProviderId[] {
  const available = useProjectConfig(projectPath)?.availableSandboxProviders ?? [];
  return ['none', ...SANDBOX_BACKEND_IDS.filter((id) => available.includes(id) || id === value)];
}

interface SandboxSegmentsProps {
  options: SandboxProviderId[];
  value: SandboxProviderId;
  onChange: (value: SandboxProviderId) => void;
}

export function SandboxSegments({ options, value, onChange }: SandboxSegmentsProps) {
  return (
    <SegmentedGroup>
      {options.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          className={`${segmentBase} ${value === id ? segmentAccent : segmentQuiet}`}
          onClick={() => onChange(id)}
        >
          {id === 'none' ? 'Host' : SANDBOX_BACKEND_LABELS[id]}
        </button>
      ))}
    </SegmentedGroup>
  );
}

export function SandboxPicker({ projectPath, value, onChange }: SandboxPickerProps) {
  const options = useSandboxOptions(projectPath, value);
  if (options.length === 1) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-text-secondary">Sandbox</span>
      <SandboxSegments options={options} value={value} onChange={onChange} />
    </div>
  );
}
