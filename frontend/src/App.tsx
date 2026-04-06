import { useState } from 'react';

export default function App() {
  const [role, setRole] = useState<string | null>(null);
  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#090d16', color: '#ffffff' }}>
      <h1>VanOla Tracking</h1>
      <p>Select your role to get started.</p>
    </div>
  );
}
