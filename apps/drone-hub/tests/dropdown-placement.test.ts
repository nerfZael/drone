import { describe, expect, test } from 'bun:test';
import { chooseDropdownVerticalPlacement } from '../src/ui/dropdown';

describe('dropdown vertical placement', () => {
  test('opens below when the anchor is near the top of its scroll area', () => {
    expect(
      chooseDropdownVerticalPlacement({
        anchorTop: 110,
        anchorBottom: 130,
        panelHeight: 160,
        viewportTop: 96,
        viewportBottom: 700,
      }),
    ).toBe('below');
  });

  test('opens above when only the space above can fit the menu', () => {
    expect(
      chooseDropdownVerticalPlacement({
        anchorTop: 650,
        anchorBottom: 670,
        panelHeight: 160,
        viewportTop: 96,
        viewportBottom: 700,
      }),
    ).toBe('above');
  });

  test('uses the larger side when neither direction fully fits', () => {
    expect(
      chooseDropdownVerticalPlacement({
        anchorTop: 210,
        anchorBottom: 230,
        panelHeight: 400,
        viewportTop: 96,
        viewportBottom: 500,
      }),
    ).toBe('below');
  });
});
