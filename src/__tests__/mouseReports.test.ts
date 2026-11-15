import { describe, expect, it } from 'vitest';
import { dropUnmeasuredMouseReports } from '../components/terminal/mouseReports';

describe('mouse reports from a detached terminal', () => {
  it('drops reports xterm could not measure and keeps everything else', () => {
    expect(dropUnmeasuredMouseReports('\x1b[<0;NaN;NaNm')).toBe('');
    expect(dropUnmeasuredMouseReports('\x1b[<32;NaN;NaNM')).toBe('');
    expect(dropUnmeasuredMouseReports('a\x1b[<0;NaN;NaNmb')).toBe('ab');
    expect(dropUnmeasuredMouseReports('\x1b[<0;12;4m')).toBe('\x1b[<0;12;4m');
    expect(dropUnmeasuredMouseReports('NaN')).toBe('NaN');
    expect(dropUnmeasuredMouseReports('\x1b[A')).toBe('\x1b[A');
  });
});
