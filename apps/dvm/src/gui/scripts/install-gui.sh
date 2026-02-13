#!/bin/bash
set -e

echo "Installing GUI components (XRDP + XFCE)..."

# Detect OS and install accordingly
if [ -f /etc/debian_version ]; then
    # Debian/Ubuntu
    export DEBIAN_FRONTEND=noninteractive
    
    # Update package list
    apt-get update -y
    
    # Install XRDP, XFCE, and required packages
    # Also install a browser-based GUI via noVNC (websockify + x11vnc + Xvfb)
    apt-get install -y \
        xrdp \
        xfce4 xfce4-goodies \
        dbus-x11 \
        x11vnc xvfb \
        novnc websockify

    # Optional: pull in Ubuntu wallpaper pack (nice defaults in /usr/share/backgrounds)
    # Not guaranteed to exist on non-Ubuntu Debian derivatives, so don't fail if missing.
    apt-get install -y ubuntu-wallpapers || true
    
    # Configure XRDP to use XFCE
    echo "xfce4-session" > /etc/xrdp/startwm.sh
    chmod +x /etc/xrdp/startwm.sh
    
    # In many Docker images systemd isn't PID 1, so services may not start here.
    # `dvm gui <name>` will start xrdp + noVNC in a Docker-friendly way.
    
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
    # `dvm gui <name>` will start xrdp + noVNC in a Docker-friendly way.
    
    echo "GUI installation completed!"
else
    echo "Unsupported OS. Please install XRDP and XFCE manually."
    exit 1
fi