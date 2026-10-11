import { useProjectStore } from '../../stores/projectStore';
import { SANDBOX_BACKEND_IDS, SANDBOX_BACKEND_LABELS, type SandboxProviderId } from '../../types';
import { SegmentedGroup, segmentAccent, segmentBase, segmentQuiet } from './SegmentedGroup';

interface SandboxPickerProps {
  value: SandboxProviderId;
  onChange: (value: SandboxProviderId) => void;
}

/**
 * Host plus each backend that can run. A chosen backend stays listed after it
 * stops being available, so the choice is visible rather than silently
 * becoming Host.
 */
export function useSandboxOptions(value: SandboxProviderId): SandboxProviderId[] {
  const available = useProjectStore((s) => s.availableSandboxProviders);
  return ['none', ...SANDBOX_BACKEND_IDS.filter((id) => available.includes(id) || id === value)];
}

export function SandboxSegments({ options, value, onChange }: SandboxPickerProps & { options: SandboxProviderId[] }) {
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

export function SandboxPicker({ value, onChange }: SandboxPickerProps) {
  const options = useSandboxOptions(value);
  if (options.length === 1) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-text-secondary">Sandbox</span>
      <SandboxSegments options={options} value={value} onChange={onChange} />
    </div>
  );
}
