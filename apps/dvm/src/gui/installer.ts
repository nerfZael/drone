import { DockerClient } from '../docker/client';
import * as fs from 'fs';
import * as path from 'path';

export class GuiInstaller {
  private docker: DockerClient;

  constructor(docker: DockerClient) {
    this.docker = docker;
  }

  async isGuiInstalled(containerName: string): Promise<boolean> {
    try {
      // Require both:
      // - XRDP (RDP access)
      // - noVNC stack (HTTP/browser access): Xvfb + x11vnc + websockify + noVNC web assets
      const check = await this.docker.execCommand(containerName, [
        'bash',
        '-lc',
        [
          'set -e',
          '(command -v xrdp >/dev/null 2>&1) && [ -f /etc/xrdp/xrdp.ini ]',
          '(command -v Xvfb >/dev/null 2>&1) && (command -v x11vnc >/dev/null 2>&1)',
          '(command -v websockify >/dev/null 2>&1)',
          '([ -d /usr/share/novnc ] || [ -d /usr/share/noVNC ] || [ -d /opt/novnc ] || command -v novnc_proxy >/dev/null 2>&1)',
          'echo ok',
        ].join('\n'),
      ]);

      return check.trim() === 'ok';
    } catch (_error) {
      return false;
    }
  }

  async installGui(containerName: string): Promise<void> {
    // Check if already installed
    const isInstalled = await this.isGuiInstalled(containerName);
    if (!isInstalled) {
      console.log('Installing GUI (XRDP + XFCE + noVNC)...');

      const scriptContent = this.getInstallScript();
      await this.executeScript(containerName, scriptContent);

      console.log('GUI installation completed successfully!');
    } else {
      console.log('GUI (XRDP + noVNC) is already installed in this container.');
    }

    // Ensure services are running (works even when installed from a base image)
    await this.startXrdpService(containerName);
    await this.startWebGuiService(containerName);
  }

  private async startWebGuiService(containerName: string): Promise<void> {
    // Provide a browser-based GUI:
    // - Xvfb (virtual display) on :1
    // - XFCE session in that display
    // - x11vnc on port 5901 (internal)
    // - websockify/noVNC on port 6080 (should be exposed to host)
    try {
      const already = await this.docker.execCommand(containerName, [
        'bash',
        '-lc',
        [
          // Detect if *anything* is listening on 6080 (websockify/noVNC).
          // Prefer ss; fall back to netstat if needed.
          'set -e',
          'if command -v ss >/dev/null 2>&1; then',
          '  ss -H -ltnp 2>/dev/null | awk \'$4 ~ /:6080$/ { found=1 } END { exit (found ? 0 : 1) }\' && echo running || echo not',
          '  exit 0',
          'fi',
          'if command -v netstat >/dev/null 2>&1; then',
          '  netstat -tlnp 2>/dev/null | awk \'$4 ~ /:6080$/ { found=1 } END { exit (found ? 0 : 1) }\' && echo running || echo not',
          '  exit 0',
          'fi',
          'echo not',
        ].join('\n'),
      ]);
      // Even if already running, continue:
      // - we may need to start missing parts (x11vnc/Xvfb/XFCE)
      // - we may still want to (re)apply wallpaper settings
      const webAlreadyRunning = already.trim() === 'running';

      // Determine noVNC web root (varies by distro/package)
      const webRoot = (
        await this.docker.execCommand(containerName, [
          'bash',
          '-lc',
          [
            'set -e',
            'if [ -d /usr/share/novnc ]; then echo /usr/share/novnc; exit 0; fi',
            'if [ -d /usr/share/noVNC ]; then echo /usr/share/noVNC; exit 0; fi',
            'if [ -d /opt/novnc ]; then echo /opt/novnc; exit 0; fi',
            'echo ""',
          ].join('\n'),
        ])
      ).trim();

      // Start Xvfb on :1 (if not running)
      await this.docker.execCommand(containerName, [
        'sh',
        '-c',
        'pgrep -x Xvfb >/dev/null 2>&1 || setsid sh -c "exec Xvfb :1 -screen 0 1280x800x24 -ac -nolisten tcp > /tmp/xvfb.log 2>&1" < /dev/null &',
      ]);

      // Start XFCE session in that display (if not running)
      await this.docker.execCommand(containerName, [
        'sh',
        '-c',
        'pgrep -x xfce4-session >/dev/null 2>&1 || setsid sh -c "export DISPLAY=:1; export XDG_RUNTIME_DIR=/tmp/xdg-runtime; mkdir -p /tmp/xdg-runtime; exec dbus-run-session -- startxfce4 > /tmp/xfce.log 2>&1" < /dev/null &',
      ]);

      // Set a nicer Ubuntu wallpaper (best-effort). This runs after XFCE starts.
      await this.docker.execCommand(containerName, [
        'bash',
        '-lc',
        [
          'set -e',
          'export DISPLAY=:1',
          // Give xfdesktop a moment to come up
          'sleep 2',
          // Pick a "modern Ubuntu" wallpaper if available, else first background
          'WALL=""',
          'for f in /usr/share/backgrounds/*ubuntu*.jpg /usr/share/backgrounds/*Ubuntu*.jpg /usr/share/backgrounds/*ubuntu*.png /usr/share/backgrounds/*Ubuntu*.png; do',
          '  if [ -f "$f" ]; then WALL="$f"; break; fi',
          'done',
          'if [ -z "$WALL" ]; then',
          '  for f in /usr/share/backgrounds/*.jpg /usr/share/backgrounds/*.png; do',
          '    if [ -f "$f" ]; then WALL="$f"; break; fi',
          '  done',
          'fi',
          'if [ -n "$WALL" ] && command -v xfconf-query >/dev/null 2>&1; then',
          // Try to talk to the *existing* XFCE session bus so this actually applies.
          // Without DBUS_SESSION_BUS_ADDRESS, xfconf-query can silently do nothing.
          '  PID="$(pgrep -x xfce4-session 2>/dev/null | head -n1 || true)"',
          '  if [ -n "$PID" ] && [ -r "/proc/${PID}/environ" ]; then',
          '    export DBUS_SESSION_BUS_ADDRESS="$(tr \'\\0\' \'\\n\' < \"/proc/${PID}/environ\" | sed -n \'s/^DBUS_SESSION_BUS_ADDRESS=//p\' | head -n1)"',
          '    export XDG_RUNTIME_DIR="$(tr \'\\0\' \'\\n\' < \"/proc/${PID}/environ\" | sed -n \'s/^XDG_RUNTIME_DIR=//p\' | head -n1)"',
          '  fi',
          // XFCE versions differ: some use image-path, others use last-image
          '  for p in $(xfconf-query -c xfce4-desktop -l 2>/dev/null | grep -E "(image-path|last-image)$" || true); do',
          '    xfconf-query -c xfce4-desktop -p "$p" -s "$WALL" 2>/dev/null || true',
          '  done',
          // Best-effort refresh
          '  if command -v xfdesktop >/dev/null 2>&1; then xfdesktop --reload 2>/dev/null || true; fi',
          'fi',
          'echo "wallpaper_set=${WALL}" > /tmp/wallpaper.log || true',
        ].join('\n'),
      ]);

      // Start x11vnc (no password by default; local-dev convenience)
      await this.docker.execCommand(containerName, [
        'sh',
        '-c',
        'pgrep -x x11vnc >/dev/null 2>&1 || setsid sh -c "export DISPLAY=:1; exec x11vnc -display :1 -rfbport 5901 -forever -shared -nopw -listen 0.0.0.0 > /tmp/x11vnc.log 2>&1" < /dev/null &',
      ]);

      // Start websockify/noVNC (6080 -> localhost:5901)
      if (webRoot) {
        await this.docker.execCommand(containerName, [
          'sh',
          '-c',
          `pgrep -x websockify >/dev/null 2>&1 || setsid sh -c "exec websockify --web=${webRoot} 6080 localhost:5901 > /tmp/novnc.log 2>&1" < /dev/null &`,
        ]);
      } else {
        await this.docker.execCommand(containerName, [
          'sh',
          '-c',
          'pgrep -x websockify >/dev/null 2>&1 || setsid sh -c "exec websockify 6080 localhost:5901 > /tmp/novnc.log 2>&1" < /dev/null &',
        ]);
      }
    } catch (error) {
      console.warn(`Warning: Could not start web GUI (noVNC): ${error}`);
    }
  }

  private async startXrdpService(containerName: string): Promise<void> {
    try {
      // In Docker containers, systemd often doesn't work, so start xrdp directly
      // First check if it's already running
      const checkRunning = await this.docker.execCommand(containerName, [
        'bash',
        '-c',
        'pgrep -x xrdp > /dev/null 2>&1 && echo "running" || echo "not running"',
      ]);
      
      if (checkRunning.trim() === 'running') {
        return; // Already running
      }

      // Start xrdp-sesman first using setsid to create a new session (Docker-friendly)
      // Using sh -c with proper redirection to ensure processes persist
      await this.docker.execCommand(containerName, [
        'sh',
        '-c',
        'setsid sh -c "exec /usr/sbin/xrdp-sesman --nodaemon > /tmp/xrdp-sesman.log 2>&1" < /dev/null &',
      ]);
      
      // Wait a moment for sesman to start
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Start xrdp using setsid to create a new session (Docker-friendly)
      await this.docker.execCommand(containerName, [
        'sh',
        '-c',
        'setsid sh -c "exec /usr/sbin/xrdp --nodaemon > /tmp/xrdp.log 2>&1" < /dev/null &',
      ]);
      
      // Wait a moment for xrdp to start
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify it's running
      const verifyRunning = await this.docker.execCommand(containerName, [
        'bash',
        '-c',
        'pgrep -x xrdp > /dev/null 2>&1 && echo "running" || echo "not running"',
      ]);
      
      if (verifyRunning.trim() !== 'running') {
        console.warn('Warning: XRDP service may not be running. Trying alternative method...');
        // Try with systemctl/service as fallback
        await this.docker.execCommand(containerName, [
          'bash',
          '-c',
          'if command -v systemctl > /dev/null 2>&1; then systemctl start xrdp 2>/dev/null || true; else service xrdp start 2>/dev/null || true; fi',
        ]);
        
        // Final verification
        const finalCheck = await this.docker.execCommand(containerName, [
          'bash',
          '-c',
          'sleep 2 && pgrep -x xrdp > /dev/null 2>&1 && echo "running" || echo "not running"',
        ]);
        
        if (finalCheck.trim() !== 'running') {
          console.warn('Warning: Could not start XRDP service automatically.');
          console.warn(`Please start it manually: dvm exec ${containerName} bash -c "nohup /usr/sbin/xrdp-sesman --nodaemon > /tmp/xrdp-sesman.log 2>&1 & nohup /usr/sbin/xrdp --nodaemon > /tmp/xrdp.log 2>&1 &"`);
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not start XRDP service: ${error}`);
      console.warn(`You may need to start it manually: dvm exec ${containerName} bash -c "nohup /usr/sbin/xrdp-sesman --nodaemon > /tmp/xrdp-sesman.log 2>&1 & nohup /usr/sbin/xrdp --nodaemon > /tmp/xrdp.log 2>&1 &"`);
    }
  }

  private getInstallScript(): string {
    const scriptName = 'install-gui.sh';
    const possiblePaths = [
      // When running from compiled dist (production)
      path.join(__dirname, 'scripts', scriptName),
      // When running from source (development)
      path.join(__dirname, '..', '..', 'src', 'gui', 'scripts', scriptName),
      // Fallback: relative to current working directory
      path.join(process.cwd(), 'src', 'gui', 'scripts', scriptName),
      // Another fallback: relative to dist
      path.join(process.cwd(), 'dist', 'gui', 'scripts', scriptName),
    ];

    for (const scriptPath of possiblePaths) {
      try {
        if (fs.existsSync(scriptPath)) {
          return fs.readFileSync(scriptPath, 'utf-8');
        }
      } catch (error) {
        // Continue to next path
        continue;
      }
    }

    // Fallback: return inline script if file not found
    return this.getInlineInstallScript();
  }

  private getInlineInstallScript(): string {
    return `#!/bin/bash
set -e

echo "Installing GUI components (XRDP + XFCE + noVNC)..."

# Detect OS and install accordingly
if [ -f /etc/debian_version ]; then
    # Debian/Ubuntu
    export DEBIAN_FRONTEND=noninteractive
    
    # Update package list
    apt-get update -y
    
    # Install XRDP, XFCE, and required packages
    # Also install browser-based GUI via noVNC (websockify + x11vnc + Xvfb)
    apt-get install -y xrdp xfce4 xfce4-goodies dbus-x11 x11vnc xvfb novnc websockify
    apt-get install -y ubuntu-wallpapers || true
    
    # Configure XRDP to use XFCE
    echo "xfce4-session" > /etc/xrdp/startwm.sh
    chmod +x /etc/xrdp/startwm.sh
    
    # In many Docker images systemd isn't PID 1, so services may not start here.
    # dvm gui <name> will start xrdp + noVNC in a Docker-friendly way.
    
    echo "GUI installation completed!"
    
elif [ -f /etc/redhat-release ] || [ -f /etc/centos-release ]; then
    # RHEL/CentOS/Fedora
    if command -v dnf > /dev/null 2>&1; then
        dnf install -y xrdp xfce4 xfce4-goodies x11vnc xorg-x11-server-Xvfb novnc websockify
    else
        yum install -y xrdp xfce4 xfce4-goodies x11vnc xorg-x11-server-Xvfb novnc websockify
    fi
    
    # Configure XRDP
    echo "xfce4-session" > /etc/xrdp/startwm.sh
    chmod +x /etc/xrdp/startwm.sh
    
    # In many Docker images systemd isn't PID 1, so services may not start here.
    # dvm gui <name> will start xrdp + noVNC in a Docker-friendly way.
    
    echo "GUI installation completed!"
else
    echo "Unsupported OS. Please install XRDP and XFCE manually."
    exit 1
fi
`;
  }

  private async executeScript(containerName: string, scriptContent: string): Promise<void> {
    const scriptPath = '/tmp/install-gui.sh';

    const container = await this.docker.getContainer(containerName);
    if (!container) {
      throw new Error(`Container ${containerName} not found`);
    }

    // Check if container is running
    const info = await container.inspect();
    if (!info.State?.Running) {
      throw new Error(`Container ${containerName} is not running. Start it first with 'dvm start ${containerName}'`);
    }

    // Write and execute the script
    const writeScript = `cat > ${scriptPath} << 'EOFSCRIPT'
${scriptContent}
EOFSCRIPT
chmod +x ${scriptPath}
${scriptPath}
`;

    await this.docker.execCommand(containerName, ['bash', '-c', writeScript]);
  }

  async ensureRdpPort(containerName: string): Promise<number> {
    const details = await this.docker.getContainerDetails(containerName);
    if (!details) {
      throw new Error(`Container ${containerName} not found`);
    }

    // Check if port 3389 is already exposed
    const rdpPort = details.ports.find((p) => p.containerPort === 3389);
    if (rdpPort && rdpPort.hostPort) {
      return rdpPort.hostPort;
    }

    // Port 3389 is not exposed, we need to add it
    // This requires container recreation, so we'll just inform the user
    // For now, return the container port and let the CLI handle it
    return 3389;
  }
}