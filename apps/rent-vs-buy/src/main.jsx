import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initAnalytics } from './analytics.js'

// Without this, an uncaught render error unmounts the whole tree and leaves just the bare
// page background — no error, no way back short of a manual refresh. This gives that state
// a visible, recoverable UI instead.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error, info) {
    console.error('Rent vs. Buy crashed:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#12141c',
            color: '#EAEAF2',
            fontFamily: "'Inter', sans-serif",
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <div>
            <p style={{ marginBottom: '16px', fontSize: '14px' }}>
              Something went wrong, likely from one of your inputs. Your last saved link (if any) still works.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#E2704A',
                color: '#12141C',
                border: 'none',
                borderRadius: '4px',
                padding: '10px 18px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: '13px',
              }}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// Fire before render so a visit still counts even if the app crashes on mount.
initAnalytics()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
