import React from 'react';
import { reportUiError } from './ui-diagnostics';

export class UiErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean; reference: string }
> {
  state = { failed: false, reference: '' };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const reference = reportUiError('react-render-error', error, { componentStack: info.componentStack ?? '' });
    this.setState({ reference });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" style={{ padding: 48, color: '#e5e7eb', background: '#11161e', minHeight: '100vh', fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>Drone Hub encountered a problem</h1>
        <p style={{ marginBottom: 16 }}>Reload the window to restore the interface.</p>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: '8px 16px', border: '1px solid #858ea3', borderRadius: 6 }}>Reload window</button>
        {this.state.reference && <p style={{ marginTop: 16, fontSize: 12 }}>Error reference: {this.state.reference}</p>}
      </main>
    );
  }
}
