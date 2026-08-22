const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

interface KanbanAddInputProps {
  onAdd: (name: string) => void;
}

/**
 * The resting state of the app's new-task composer: one row pinned in the
 * column footer. The demos never open the full composer, so this vendored
 * copy renders only that row.
 */
export function KanbanAddInput({ onAdd }: KanbanAddInputProps) {
  void onAdd;
  return (
    <button type="button" className="kanban-add-rest" aria-label="New task">
      <span className="kanban-add-rest-plus">+</span>
      <span>New task</span>
      <span className="kanban-add-button-hint kanban-add-button-hint-text">{isMac ? '⌘' : 'Ctrl+'}N</span>
    </button>
  );
}
