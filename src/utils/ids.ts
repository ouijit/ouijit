/**
 * Shared ID generation utilities
 */

/**
 * Generate a unique ID with a prefix
 * @param prefix - The prefix for the ID (e.g., 'pty', 'hook', 'custom')
 * @returns A unique ID string in the format `prefix-timestamp-random`
 */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
