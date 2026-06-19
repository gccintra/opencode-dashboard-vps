import { Component, StrictMode } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

interface EBState { error: Error | null }

class RootErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[RootErrorBoundary]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div style={{ padding: 24, background: '#0a0a0f', minHeight: '100vh', color: '#ff9c9c', fontFamily: 'monospace', fontSize: 13 }}>
          <div style={{ marginBottom: 8, color: '#f0f0f0', fontSize: 15 }}>Something went wrong</div>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#ff9c9c' }}>{error.message}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '6px 14px', background: '#b3e502', color: '#0a0a0f', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
