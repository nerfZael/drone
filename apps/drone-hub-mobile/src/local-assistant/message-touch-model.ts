export function shouldToggleMessageTimestamp(input: {
  active: boolean;
  moved: boolean;
  longPressed: boolean;
}): boolean {
  return input.active && !input.moved && !input.longPressed;
}
