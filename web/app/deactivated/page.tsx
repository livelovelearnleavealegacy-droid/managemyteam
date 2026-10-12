// Deactivated account page. Shown to users whose staff record has been
// terminated (the (app) layout routes them here; the check itself is wired
// there by the coordinator).

export default function DeactivatedPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div className="card" style={{ maxWidth: 480, textAlign: 'center' }}>
        <h1 className="page-title">Account deactivated</h1>
        <p style={{ color: 'var(--text2)' }}>
          Your account has been deactivated. Contact your administrator.
        </p>
      </div>
    </main>
  );
}
