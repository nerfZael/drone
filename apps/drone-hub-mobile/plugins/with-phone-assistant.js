const { withMainActivity } = require('@expo/config-plugins');

function addAssistantLifecycle(source) {
  if (source.includes('CompanionAssistantLaunch.attach(this)')) {
    if (!source.includes('CompanionAssistantLaunch.accept(this, intent)')) {
      throw new Error('MainActivity has an incomplete Companion assistant onNewIntent handoff');
    }
    return source;
  }
  if (!source.includes('super.onCreate(null)')) throw new Error('Cannot find MainActivity onCreate for Companion assistant');
  if (source.includes('override fun onNewIntent')) throw new Error('Merge Companion assistant into the existing MainActivity onNewIntent');
  if (!source.includes('class MainActivity : ReactActivity() {') || !source.includes('import android.os.Bundle')) {
    throw new Error('Unsupported MainActivity template for Companion assistant');
  }
  return source
    .replace('import android.os.Bundle', 'import android.os.Bundle\nimport android.content.Intent\nimport expo.modules.dronelivevoice.CompanionAssistantLaunch')
    .replace('super.onCreate(null)', 'super.onCreate(null)\n    CompanionAssistantLaunch.attach(this)')
    .replace('class MainActivity : ReactActivity() {', `class MainActivity : ReactActivity() {
  override fun onNewIntent(intent: Intent) {
    CompanionAssistantLaunch.accept(this, intent)
    setIntent(intent)
    super.onNewIntent(intent)
  }
`);
}

module.exports = function withPhoneAssistant(config) {
  return withMainActivity(config, (config) => {
    config.modResults.contents = addAssistantLifecycle(config.modResults.contents);
    return config;
  });
};
module.exports.addAssistantLifecycle = addAssistantLifecycle;
