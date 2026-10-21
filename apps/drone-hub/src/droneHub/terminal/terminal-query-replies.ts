import type { Terminal } from '@xterm/xterm';

// The shell's real terminal is tmux, which answers these queries itself; the
// Hub view sees the same bytes through control mode. A second answer from the
// view reaches the pane after the program has read tmux's, so it lands at the
// shell prompt as text like `11;rgb:1111/1111/1b1b;1R`. Queries tmux 3.4 leaves
// unanswered (DECXCPR, DECRQM, DECRQSS, OSC 4 and 12) are still answered here.
export function leaveQueryRepliesToTmux(terminal: Terminal) {
  const { parser } = terminal;
  parser.registerCsiHandler({ final: 'c' }, () => true);
  parser.registerCsiHandler({ prefix: '>', final: 'c' }, () => true);
  parser.registerCsiHandler({ final: 'n' }, (params) => params[0] === 5 || params[0] === 6);
  for (const ident of [10, 11]) parser.registerOscHandler(ident, (data) => data === '?');
}
