function zoomActionForInput(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown' || input.alt) return null;
  const primaryModifier = platform === 'darwin' ? input.meta : input.control;
  if (!primaryModifier) return null;

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '').toLowerCase();
  if (key === '+' || key === '=' || key === 'add' || code === 'numpadadd') return 'in';
  if (key === '-' || key === '_' || key === 'subtract' || code === 'numpadsubtract') return 'out';
  if (key === '0' || code === 'numpad0') return 'reset';
  return null;
}

module.exports = {
  zoomActionForInput,
};
