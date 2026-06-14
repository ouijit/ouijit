import { describe, test, expect } from 'vitest';
import { projectIconColor, stringToColor } from '../utils/projectIcon';

describe('projectIconColor', () => {
  test('uses the custom override when set, else the name-generated color', () => {
    expect(projectIconColor({ name: 'ouijit', iconColor: '#123456' })).toBe('#123456');
    expect(projectIconColor({ name: 'ouijit' })).toBe(stringToColor('ouijit'));
  });
});
