const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

// Only the browser gateway's loopback pool permits HTTP. Device transport stays HTTPS.
const networkConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
${Array.from({ length: 253 }, (_, n) => `    <domain includeSubdomains="false">127.0.0.${n + 2}</domain>`).join('\n')}
  </domain-config>
</network-security-config>
`;
const debugNetworkConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config><base-config cleartextTrafficPermitted="true" /></network-security-config>
`;

module.exports = function withBrowserLoopback(config) {
  config = withAndroidManifest(config, (config) => {
    config.modResults.manifest.application[0].$['android:networkSecurityConfig'] =
      '@xml/browser_network_security';
    return config;
  });
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const directory = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'browser_network_security.xml'), networkConfig);
      // Preserve Metro's existing HTTP access in development builds.
      for (const variant of ['debug', 'debugOptimized']) {
        const debugDirectory = path.join(
          config.modRequest.platformProjectRoot,
          `app/src/${variant}/res/xml`,
        );
        await fs.mkdir(debugDirectory, { recursive: true });
        await fs.writeFile(
          path.join(debugDirectory, 'browser_network_security.xml'),
          debugNetworkConfig,
        );
      }
      return config;
    },
  ]);
};
module.exports.networkConfig = networkConfig;
module.exports.debugNetworkConfig = debugNetworkConfig;
