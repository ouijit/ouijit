import { useState, type ReactNode } from 'react';
import { Icon } from '../terminal/Icon';

/**
 * The parts a detail pane is built from, shared by pull requests and issues so
 * the two read as the same document with different contents.
 */

export function Dot() {
  return <span className="text-text-tertiary opacity-60">·</span>;
}

/** One label-and-value row. The label column is fixed so the values line up. */
export function Fact({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="flex items-center gap-2 w-[150px] shrink-0 text-[15px] text-text-tertiary">
        <Icon name={icon} className="w-4 h-4 shrink-0 opacity-70" />
        {label}
      </dt>
      <dd className="flex items-center gap-1.5 min-w-0 flex-wrap text-[15px]">{children}</dd>
    </div>
  );
}

/**
 * A heading, a rule under it, and content. The rule belongs to the heading
 * rather than to the boundary between sections, which is why there is only
 * ever one of them and never two lines meeting.
 */
export function Section({
  label,
  count,
  defaultOpen = false,
  children,
}: {
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        className="group flex items-center gap-2 pb-2.5 border-b border-ink/[0.08] text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[19px] font-medium text-text-primary">{label}</span>
        <Icon
          name="caret-right"
          className={`w-4 h-4 text-text-tertiary transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        {count != null && count > 0 && <span className="text-[15px] text-text-tertiary">{count}</span>}
      </button>
      {open && <div className="pt-4">{children}</div>}
    </section>
  );
}

/** The coloured dot GitHub puts beside a label name, at the size this app uses. */
export function LabelChips({ labels }: { labels: Array<{ name: string; color: string }> }) {
  return (
    <>
      {labels.map((label) => (
        <span key={label.name} className="flex items-center gap-1.5 text-[15px] text-text-primary">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: `#${label.color}` }} />
          {label.name}
        </span>
      ))}
    </>
  );
}
