import { formatRelativeTime } from '../../utils/formatDate';

/** Both trackers timestamp in ISO strings; the shared formatter takes a Date. */
export function since(isoTimestamp: string): string {
  return formatRelativeTime(new Date(isoTimestamp));
}
