const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function checkCompanionPanel({ owner, BrowserWindow, screen, url, waitFor }) {
  // Start attached regardless of a floating-window preference persisted by an earlier run on this machine.
  await owner.webContents.session.clearStorageData();
  await owner.loadURL(url);
  const js = code => owner.webContents.executeJavaScript(code, true);
  await waitFor(() => js('Boolean(document.querySelector(\'[aria-label="Companion options"]\'))'), 'real Companion overlay');
  await js('document.querySelector(\'[aria-label="Companion options"]\').click()');
  await waitFor(() => js("Boolean([...document.querySelectorAll('[role=switch]')].find(el => el.textContent.includes('Floating window')))"), 'floating switch');
  await js("[...document.querySelectorAll('[role=switch]')].find(el => el.textContent.includes('Floating window')).click()");
  const child = BrowserWindow.getAllWindows().find(win => win !== owner);
  assert(child);
  const childJs = code => child.webContents.executeJavaScript(code, true);
  await waitFor(() => child.isVisible() && child.getBounds().height < 100, 'compact listening panel');
  const compact = child.getBounds();
  const area = screen.getPrimaryDisplay().workArea;
  assert.equal(compact.x + compact.width, area.x + area.width - 16);
  assert.equal(compact.y + compact.height, area.y + area.height - 16);
  assert.equal(child.isResizable(), false);
  assert.equal(await childJs("getComputedStyle(document.body).backgroundColor"), 'rgba(0, 0, 0, 0)');
  assert.equal(await childJs("Boolean(document.querySelector('.drone-hub-desktop-title-bar'))"), false);
  const flowOf = () => childJs("document.querySelector('[data-companion-window-panel]').dataset.companionFlow");
  const screenRect = async (selector) => {
    const rect = JSON.parse(await childJs(`JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON())`));
    const bounds = child.getBounds();
    return { top: bounds.y + rect.top, bottom: bounds.y + rect.bottom, left: bounds.x + rect.left, width: rect.width };
  };
  const barRect = () => screenRect('[data-companion-window-bar]');
  const bodyRect = () => screenRect('[data-companion-window-bar] ~ :not([data-companion-window-bar]), [data-companion-window-bar] + *');
  const near = (actual, expected, label) => assert(Math.abs(actual - expected) <= 1, `${label}: ${actual} vs ${expected}`);
  const grow = () => js("updateCompanionPanel({status:'completed', reply:'A reply that grows the panel. '.repeat(90)})");
  const shrink = () => js("updateCompanionPanel({status:'recording', reply:''})");
  const boundsBefore = child.getBounds();
  const barBefore = await barRect();
  assert.equal(await flowOf(), 'up');
  await grow();
  await waitFor(() => child.getBounds().height > 150, 'reply expands compact panel');
  assert.equal(child.getBounds().y + child.getBounds().height, boundsBefore.y + boundsBefore.height);
  // The bar keeps its exact screen position and width; the reply appears above it.
  assert.deepEqual(await barRect(), barBefore);
  assert((await bodyRect()).bottom <= barBefore.top + 1, 'reply sits above a bar that is low on the screen');
  await shrink();
  await waitFor(() => child.getBounds().height < 100, 'clearing reply shrinks panel');
  assert.deepEqual(await barRect(), barBefore);
  // Dragged to the top of the screen, content flows downward instead, and the bar stays where it was dropped.
  const droppedBarTop = area.y + 16 + (barBefore.top - boundsBefore.y);
  child.setBounds({ ...child.getBounds(), y: area.y + 16 });
  await waitFor(async () => (await flowOf()) === 'down', 'flow flips downward near the top');
  await waitFor(async () => Math.abs((await barRect()).top - droppedBarTop) <= 1, 'bar keeps its place after flipping');
  const barHigh = await barRect();
  const topBefore = child.getBounds().y;
  await grow();
  await waitFor(() => child.getBounds().height > 150, 'reply expands downward');
  assert.equal(child.getBounds().y, topBefore);
  assert.deepEqual(await barRect(), barHigh);
  assert((await bodyRect()).top >= barHigh.bottom - 1, 'reply sits below a bar that is high on the screen');
  await shrink();
  await waitFor(() => child.getBounds().height < 100, 'clearing reply shrinks downward panel');
  assert.deepEqual(await barRect(), barHigh);
  near(barHigh.width, barBefore.width, 'bar width');
  // Back near the bottom corner: content flows upward again for the menu checks.
  child.setBounds({ ...child.getBounds(), y: boundsBefore.y });
  await waitFor(async () => (await flowOf()) === 'up' && child.getBounds().height < 100, 'flow flips upward near the bottom');
  await childJs('document.querySelector(\'[aria-label="Companion options"]\').click()');
  await waitFor(() => child.getBounds().height >= Math.min(600, area.height - 32), 'room for options');
  await waitFor(() => childJs("[...document.querySelectorAll('[role=switch]')].some(el => el.textContent.includes('Floating window'))"), 'options visible');
  const menuBounds = await childJs("JSON.stringify([...document.querySelectorAll('[data-companion-surface]')].find(el => el.getAttribute('aria-label') === 'Companion options').getBoundingClientRect().toJSON())");
  const menu = JSON.parse(menuBounds);
  assert(menu.y >= 0 && menu.bottom <= child.getBounds().height + 1);
  await childJs('document.querySelector(\'[aria-label="Companion options"]\').click()');
  await waitFor(() => child.getBounds().height < 100, 'closing options shrinks panel');
  if (process.env.COMPANION_SCREENSHOT) fs.writeFileSync(process.env.COMPANION_SCREENSHOT, (await child.webContents.capturePage()).toPNG());
  console.log(`PASS: actual Companion panel ${compact.width}×${compact.height}, primary-display bottom-right, transparent background, fixed bar with replies flowing up or down, menu growth and shrink`);
};
