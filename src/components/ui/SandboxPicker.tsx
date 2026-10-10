import { useProjectStore } from '../../stores/projectStore';
import { SANDBOX_BACKEND_IDS, SANDBOX_BACKEND_LABELS, type SandboxProviderId } from '../../types';
import { SegmentedGroup, segmentAccent, segmentBase, segmentQuiet } from './SegmentedGroup';

interface SandboxPickerProps {
  value: SandboxProviderId;
  onChange: (value: SandboxProviderId) => void;
}

/**
 * A chosen backend stays listed after it stops being available, so the choice
 * is visible rather than silently becoming Host.
 */
export function SandboxPicker({ value, onChange }: SandboxPickerProps) {
  const available = useProjectStore((s) => s.availableSandboxProviders);
  const options: SandboxProviderId[] = [
    'none',
    ...SANDBOX_BACKEND_IDS.filter((id) => available.includes(id) || id === value),
  ];
  if (options.length === 1) return null;

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-text-secondary">Sandbox</span>
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
    </div>
  );
}
