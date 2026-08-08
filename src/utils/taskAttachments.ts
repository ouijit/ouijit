import { useProjectStore } from '../stores/projectStore';

/**
 * Resolve a pasted or dropped file to the absolute path that goes into a task
 * description as a chip. Returns null when the file can't be attached, having
 * already surfaced the reason as a toast.
 *
 * Shared by every surface that edits a description — the column composer, its
 * expanded sheet, and the card — so all three treat a dropped file the same
 * way.
 */
export async function resolveAttachmentPath(file: File): Promise<string | null> {
  // Prefer the file's existing on-disk path — drag-drop from Finder and most
  // clipboard file pastes already have one. Skipping the copy keeps the user's
  // file under their control and works for any extension.
  const existingPath = window.api.getPathForFile(file);
  if (existingPath) return existingPath;

  // No source path — bytes only (typically a clipboard-pasted screenshot).
  // Save those to userData so CLI agents have a stable path to read.
  if (!file.type.startsWith('image/')) {
    useProjectStore.getState().addToast('Only image clipboard content can be attached', 'error');
    return null;
  }
  const ext = file.type.split('/')[1] || 'png';
  const data = new Uint8Array(await file.arrayBuffer());
  const result = await window.api.task.saveAttachment(data, ext);
  if (result.success && result.path) return result.path;

  useProjectStore.getState().addToast(result.error || 'Failed to attach image', 'error');
  return null;
}
