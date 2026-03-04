import { Component } from 'react'

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    // Keep details in console for postmortem debugging.
    console.error('Unhandled React error boundary catch', error, errorInfo)
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: '#f7f2e7',
        padding: '1rem',
      }}>
        <div style={{
          width: 'min(440px, 100%)',
          borderRadius: '14px',
          border: '1px solid #cfae72',
          background: '#fff6e4',
          boxShadow: '0 12px 26px rgba(0,0,0,0.18)',
          padding: '1rem',
          textAlign: 'center',
        }}>
          <h2 style={{ margin: 0, color: '#4d2e1a', fontSize: '1.1rem' }}>Something went wrong</h2>
          <p style={{ margin: '0.65rem 0 0', color: '#6a4f22', fontSize: '0.9rem' }}>
            The app hit an unexpected error. Reload to continue.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              marginTop: '0.85rem',
              border: '1px solid #b88f52',
              borderRadius: '10px',
              background: '#f3a84d',
              color: '#fff',
              fontWeight: 700,
              padding: '0.45rem 0.95rem',
              cursor: 'pointer',
            }}
          >
            Reload App
          </button>
        </div>
      </div>
    )
  }
}

export default AppErrorBoundary
