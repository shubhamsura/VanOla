import { useState, useEffect, useRef } from 'react';
import { 
  Car, 
  User, 
  Trash2, 
  Wifi, 
  WifiOff, 
  Clock, 
  RefreshCw,
  Copy,
  Check,
  Search,
  AlertCircle
} from 'lucide-react';
import { useSocket } from './hooks/useSocket';
import type { Stop } from './hooks/useSocket';
import { useGeolocation } from './hooks/useGeolocation';
import { MapComponent } from './components/MapComponent';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

// Helper function to calculate distance using Haversine formula
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return d; // Distance in km
};

function App() {
  const [role, setRole] = useState<'driver' | 'student' | null>(null);
  
  // Custom socket hook
  const {
    isConnected,
    currentSessionState,
    sessionError,
    setSessionError,
    joinSession,
    updateLocation,
    stopSession,
    createSession,
    fetchSessionState
  } = useSocket();

  // Custom geolocation hook
  const {
    lat: geoLat,
    lng: geoLng,
    speed: geoSpeed,
    error: geoError,
    isWatching,
    wakeLockActive,
    startWatching,
    stopWatching
  } = useGeolocation();

  // Track session details
  const [driverCode, setDriverCode] = useState<string>('');
  const [studentCodeInput, setStudentCodeInput] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);
  
  // Driver settings
  const [stops, setStops] = useState<Stop[]>([]);
  const [newStopName, setNewStopName] = useState('');
  const [isStopAddingMode, setIsStopAddingMode] = useState(false);
  const [simulationMode, setSimulationMode] = useState(false); // Default to false so real live GPS is active by default
  const [simulatedLocation, setSimulatedLocation] = useState<{ lat: number; lng: number } | null>(null);
  
  // Geosearch states
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [mapCenterOverride, setMapCenterOverride] = useState<[number, number] | null>(null);

  // Student position
  const [studentGeoLocation, setStudentGeoLocation] = useState<{ lat: number; lng: number } | null>(null);
  
  // Mobile drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [mapStyle, setMapStyle] = useState<'roadmap' | 'satellite'>('roadmap');
  
  // Loading & Connection Error states
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [sessionConnectionError, setSessionConnectionError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(50);
  const backgroundAudioRef = useRef<HTMLAudioElement | null>(null);

  // Clear errors when changing roles & lock scrolling for dashboard view
  useEffect(() => {
    setSessionError(null);
    setDriverCode('');
    setStudentCodeInput('');

    if (role) {
      document.body.classList.add('dashboard-active');
    } else {
      document.body.classList.remove('dashboard-active');
    }

    return () => {
      document.body.classList.remove('dashboard-active');
    };
  }, [role, setSessionError]);

  // Auto re-join session room when socket reconnects
  useEffect(() => {
    if (isConnected && driverCode && role) {
      joinSession(driverCode, role);
    }
  }, [isConnected, driverCode, role, joinSession]);

  // Keep sending GPS coordinates to socket when tracking is active
  useEffect(() => {
    if (!isWatching && !simulatedLocation) return;
    if (!driverCode) return;

    let updateInterval: any;

    const sendUpdate = () => {
      let lat = 0;
      let lng = 0;
      let speed = 0;

      if (simulationMode && simulatedLocation) {
        lat = simulatedLocation.lat;
        lng = simulatedLocation.lng;
        speed = 6.9; // Simulate ~25 km/h
      } else if (geoLat && geoLng) {
        lat = geoLat;
        lng = geoLng;
        speed = geoSpeed || 0;
      } else {
        return; // Coordinates not ready
      }

      updateLocation(driverCode, lat, lng, speed, stops);
    };

    sendUpdate();
    updateInterval = setInterval(sendUpdate, 2000);

    return () => clearInterval(updateInterval);
  }, [isWatching, simulationMode, simulatedLocation, geoLat, geoLng, geoSpeed, driverCode, stops, updateLocation]);

  // Sync stops from server session state
  useEffect(() => {
    if (currentSessionState && currentSessionState.driverCode === driverCode) {
      setStops(currentSessionState.stops || []);
    }
  }, [currentSessionState, driverCode]);

  // Autocomplete suggestions as user types with 400ms debounce
  useEffect(() => {
    if (searchQuery.trim().length < 3) {
      setSearchResults([]);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            searchQuery
          )}&limit=5&addressdetails=1`
        );
        if (response.ok) {
          const data = await response.json();
          setSearchResults(data);
        }
      } catch (err) {
        console.error('Failed to geocode query:', err);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  // Copy code to clipboard
  const handleCopyCode = () => {
    navigator.clipboard.writeText(driverCode);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Driver Starts session
  const handleStartTrip = async () => {
    setSessionConnectionError(null);
    setIsCreatingSession(true);
    setCountdown(50);

    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 1 ? prev - 1 : 1));
    }, 1000);
    
    // 1. Immediately request location permission (critical for iOS/Safari immediate click gesture rule)
    if (!simulationMode) {
      startWatching();
    }

    try {
      // 2. Create session on backend
      const session = await createSession(stops);
      if (session) {
        const generatedCode = session.driverCode;
        setDriverCode(generatedCode);
        setIsDrawerOpen(false); // Collapse drawer to show full map initially
        joinSession(generatedCode, 'driver');
        
        // 3. Play silent audio in loop (audio wake lock) to prevent mobile OS from suspending execution in the background
        try {
          const silentAudio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
          silentAudio.loop = true;
          silentAudio.play();
          backgroundAudioRef.current = silentAudio;
          console.log("Background audio wake lock engaged.");
        } catch (e) {
          console.warn("Background audio blocker bypass failed:", e);
        }

        if (simulationMode) {
          setSimulatedLocation({ lat: 23.0772, lng: 76.8513 });
        }
      } else {
        setSessionConnectionError("Failed to wake up tracking server. Render's free tier takes up to 50 seconds to boot. Please wait and try again.");
        stopWatching();
      }
    } catch (err) {
      console.error(err);
      setSessionConnectionError("Could not connect to tracking server. Check your VITE_BACKEND_URL variable.");
      stopWatching();
    } finally {
      clearInterval(timer);
      setIsCreatingSession(false);
    }
  };

  // Driver stops session
  const handleStopTrip = () => {
    if (!driverCode) return;
    stopWatching();
    stopSession(driverCode);
    setDriverCode('');
    setSimulatedLocation(null);
    setStops([]);
    setMapCenterOverride(null);
    setSearchResults([]);

    // Stop background audio wake lock
    if (backgroundAudioRef.current) {
      try {
        backgroundAudioRef.current.pause();
        backgroundAudioRef.current = null;
        console.log("Background audio wake lock released.");
      } catch (e) {
        console.error("Failed to release background audio:", e);
      }
    }
  };

  // Student starts tracking
  const handleStudentTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = studentCodeInput.trim().toUpperCase();
    if (!code) return;

    // 1. Check if the session exists on the backend
    const session = await fetchSessionState(code);
    if (session) {
      setDriverCode(code);
      setIsDrawerOpen(false); // Collapse drawer to show map initially
      joinSession(code, 'student');

      // 2. Request student's local browser GPS for relative distance calculations
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setStudentGeoLocation({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude
            });
          },
          (err) => console.warn('Could not acquire student location:', err.message),
          { enableHighAccuracy: true }
        );
      }
    }
  };

  // Geocode stop point search (Nominatim API)
  const handleSearchStop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery
        )}&limit=5&addressdetails=1`
      );
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data);
        // Automatically pan map to the first search result if available
        if (data && data.length > 0) {
          const lat = parseFloat(data[0].lat);
          const lng = parseFloat(data[0].lon);
          setMapCenterOverride([lat, lng]);
        }
      }
    } catch (err) {
      console.error('Failed to geocode stop:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Add stop from geocoding search results
  const selectSearchResult = (result: any) => {
    const displayName = result.display_name;
    const shortName = displayName.split(',')[0] || 'Stop';
    
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);

    const newStop: Stop = {
      id: `stop-${Date.now()}`,
      name: shortName,
      lat,
      lng,
    };

    const updatedStops = [...stops, newStop];
    setStops(updatedStops);
    setSearchResults([]);
    setSearchQuery('');
    setMapCenterOverride([lat, lng]);

    // If simulating, move the simulated van to this stop location to follow the route easily
    if (simulationMode) {
      setSimulatedLocation({ lat, lng });
    }

    // Save stops on backend
    if (driverCode) {
      fetch(`${BACKEND_URL}/api/sessions/${driverCode}/stops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stops: updatedStops })
      });
    }
  };

  // Add stops (dynamic stops)
  const addStopAtCoords = (lat: number, lng: number) => {
    const name = newStopName.trim() || `Stop ${stops.length + 1}`;
    const newStop: Stop = {
      id: `stop-${Date.now()}`,
      name,
      lat,
      lng
    };

    const updatedStops = [...stops, newStop];
    setStops(updatedStops);
    setNewStopName('');
    setIsStopAddingMode(false);

    // Save stops on backend
    if (driverCode) {
      fetch(`${BACKEND_URL}/api/sessions/${driverCode}/stops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stops: updatedStops })
      });
    }
  };

  // Delete stops
  const handleDeleteStop = (stopId: string) => {
    const updatedStops = stops.filter(s => s.id !== stopId);
    setStops(updatedStops);
    
    if (driverCode) {
      fetch(`${BACKEND_URL}/api/sessions/${driverCode}/stops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stops: updatedStops })
      });
    }
  };

  // Map clicks
  const handleMapClick = (lat: number, lng: number) => {
    if (role === 'driver') {
      if (isStopAddingMode) {
        addStopAtCoords(lat, lng);
      } else if (simulationMode) {
        setSimulatedLocation({ lat, lng });
      }
    }
  };

  const isCurrentlyTracking = isWatching || (simulationMode && simulatedLocation !== null);
  const isProdFallback = window.location.hostname !== 'localhost' && BACKEND_URL.includes('localhost');

  const handleBackToRoles = () => {
    handleStopTrip();
    setRole(null);
    setDriverCode('');
    setStudentCodeInput('');
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="logo-container">
          <div className="logo-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 18H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"></path>
              <path d="M14 6v12"></path>
              <circle cx="7.5" cy="18.5" r="2.5"></circle>
              <circle cx="16.5" cy="18.5" r="2.5"></circle>
              <path d="M18 16h4v-3h-4Z"></path>
            </svg>
          </div>
          <span className="logo-text">VanOla</span>
          <span className="logo-tag">VIT Bhopal Campus</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
            {isConnected ? (
              <span style={{ color: 'var(--secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Wifi size={16} /> <span className="header-status-text">Server Connected</span>
              </span>
            ) : (
              <span style={{ color: 'var(--error)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <WifiOff size={16} /> <span className="header-status-text">Connecting...</span>
              </span>
            )}
          </div>

          {role && (
            <div className="role-badge" onClick={handleBackToRoles}>
              Switch Mode
            </div>
          )}
        </div>
      </header>

      {/* Role Selection Screen */}
      {!role && (
        <main className="role-selection-overlay">
          <div className="selector-grid">
            <div className="glass-card role-selector-card driver-selector" onClick={() => setRole('driver')}>
              <div className="icon-wrapper">
                <Car size={36} />
              </div>
              <h2 className="role-title">I am a Driver</h2>
              <p className="role-description">
                Start a ride near VIT Bhopal, automatically generate a student tracking code, and stream your coordinates in real-time.
              </p>
              <button className="btn btn-primary" style={{ width: '100%' }}>Start Driver Session</button>
            </div>

            <div className="glass-card role-selector-card student-selector" onClick={() => setRole('student')}>
              <div className="icon-wrapper">
                <User size={36} />
              </div>
              <h2 className="role-title">I am a Student</h2>
              <p className="role-description">
                Enter your driver's unique code to locate their van on VIT Bhopal map, view stops, and calculate your arrival times.
              </p>
              <button className="btn btn-secondary" style={{ width: '100%' }}>Track Live Van</button>
            </div>
          </div>
        </main>
      )}

      {/* Panels */}
      {role && (
        <main className="dashboard-main">
          {/* Sidebar (Responsive Bottom Sheet Drawer on Mobile) */}
          <section className={`sidebar-container ${isDrawerOpen ? 'expanded' : 'collapsed'}`}>
            <div className="drawer-handle" onClick={() => setIsDrawerOpen(!isDrawerOpen)}></div>
            
            {/* Mobile-only summary header when collapsed */}
            <div className="mobile-summary-header" onClick={() => setIsDrawerOpen(true)}>
              {role === 'driver' ? (
                !driverCode ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ fontWeight: 600, color: 'var(--primary)' }}>🚗 Ready to Start Ride</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Tap to setup ↗</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="live-badge" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center' }}>
                        <span className="pulse-dot"></span> LIVE
                      </span>
                      <strong style={{ fontFamily: 'monospace', fontSize: '1.1rem' }}>{driverCode}</strong>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{stops.length} stops active</span>
                  </div>
                )
              ) : (
                !driverCode ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ fontWeight: 600, color: 'var(--secondary)' }}>🔍 Track College Van</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Tap to enter code ↗</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="live-badge" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center' }}>
                        <span className="pulse-dot"></span> TRACKING
                      </span>
                      <strong style={{ fontFamily: 'monospace', fontSize: '1.1rem' }}>{driverCode}</strong>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {currentSessionState?.status === 'active' ? 'Active' : 'Offline'}
                    </span>
                  </div>
                )
              )}
            </div>
            
            {/* DRIVER DASHBOARD */}
            {role === 'driver' && (
              <>
                <div className="glass-card accent-border-primary">
                  <h3>Driver Dashboard</h3>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                    Generate a tracking code to start broadcasting location.
                  </p>

                  {!driverCode ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {geoError && !simulationMode && (
                        <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--error)', padding: '0.75rem', borderRadius: '12px', color: 'var(--error)', fontSize: '0.85rem' }}>
                          <AlertCircle size={18} style={{ flexShrink: 0 }} />
                          <span><strong>GPS Permission Blocked:</strong> {geoError}. Please enable location permissions in browser settings.</span>
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={simulationMode}
                            onChange={(e) => setSimulationMode(e.target.checked)}
                          />
                          Simulate GPS near VIT Bhopal
                        </label>
                      </div>

                      {sessionConnectionError && (
                        <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--error)', padding: '0.75rem', borderRadius: '12px', color: 'var(--error)', fontSize: '0.85rem' }}>
                          <AlertCircle size={18} style={{ flexShrink: 0 }} />
                          <span>{sessionConnectionError}</span>
                        </div>
                      )}

                      <button 
                        className="btn btn-primary" 
                        onClick={handleStartTrip} 
                        style={{ width: '100%' }}
                        disabled={isCreatingSession}
                      >
                        {isCreatingSession ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                            <RefreshCw className="spin-loader" size={16} /> Waking up server ({countdown}s)...
                          </span>
                        ) : (
                          'Start Ride & Generate Code'
                        )}
                      </button>
                    </div>
                  ) : (
                    <div>
                      {/* Display Generated Driver Code */}
                      <div style={{
                        background: 'rgba(99, 102, 241, 0.1)',
                        border: '1px solid var(--primary)',
                        borderRadius: '12px',
                        padding: '1rem',
                        textAlign: 'center',
                        marginBottom: '1rem'
                      }}>
                        <div className="input-label" style={{ marginBottom: '0.25rem', fontSize: '0.75rem' }}>Student Sharing Code</div>
                        <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '0.1em', fontFamily: 'monospace' }}>
                          {driverCode}
                        </div>
                        <button className="btn btn-outline" style={{ marginTop: '0.5rem', width: '100%', fontSize: '0.85rem' }} onClick={handleCopyCode}>
                          {isCopied ? (
                            <span style={{ color: 'var(--secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                              <Check size={14} /> Code Copied!
                            </span>
                          ) : (
                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                              <Copy size={14} /> Copy Code
                            </span>
                          )}
                        </button>
                      </div>

                      <button className="btn btn-danger" onClick={handleStopTrip} style={{ width: '100%' }}>
                        Stop Ride Session
                      </button>
                    </div>
                  )}
                </div>

                {driverCode && (
                  <div className="glass-card">
                    <h3>Declare Stop Points</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                      Search for stops or click on the map to declare pickup points.
                    </p>

                    {/* Geosearch Input */}
                    <form onSubmit={handleSearchStop} style={{ marginBottom: '1rem' }}>
                      <div className="input-group">
                        <label className="input-label">Search Drop/Pickup Point</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <input
                            type="text"
                            placeholder="e.g. VIT Bhopal, Ashta, hostel"
                            className="text-input"
                            style={{ flex: 1 }}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                          />
                          <button type="submit" className="btn btn-secondary" style={{ padding: '0.75rem' }} disabled={isSearching}>
                            {isSearching ? '...' : <Search size={18} />}
                          </button>
                        </div>
                      </div>
                    </form>

                    {/* Search Results Dropdown List */}
                    {searchResults.length > 0 && (
                      <div style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-card)',
                        borderRadius: '12px',
                        padding: '0.5rem',
                        marginBottom: '1rem',
                        maxHeight: '200px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem',
                        boxShadow: 'var(--shadow-lg)'
                      }}>
                        <div className="input-label" style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem' }}>Search Results</div>
                        {searchResults.map((result: any) => (
                          <div
                            key={result.place_id}
                            style={{
                              padding: '0.5rem',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              fontSize: '0.85rem',
                              transition: 'var(--transition-all)'
                            }}
                            className="search-suggestion-item"
                            onClick={() => selectSearchResult(result)}
                          >
                            <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{result.display_name.split(',')[0]}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {result.display_name}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {searchQuery.trim().length >= 3 && searchResults.length === 0 && !isSearching && (
                      <div style={{
                        padding: '0.75rem',
                        background: 'rgba(245, 158, 11, 0.1)',
                        border: '1px solid var(--accent)',
                        borderRadius: '12px',
                        fontSize: '0.8rem',
                        color: 'var(--accent)',
                        marginBottom: '1rem',
                        lineHeight: '1.4'
                      }}>
                        📌 **No exact matches found**: Try searching for a broader term like <strong>"Ashta"</strong> or <strong>"VIT Bhopal"</strong> to pan the map, then turn on **Declare Stop on Map** and click directly on your street to add it!
                      </div>
                    )}

                    {/* Custom styling for list elements hover */}
                    <style>{`
                      .search-suggestion-item:hover {
                        background: rgba(255, 255, 255, 0.08);
                      }
                    `}</style>

                    <div style={{ borderTop: '1px solid var(--border-card)', padding: '1rem 0 0.5rem 0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label">Or Declare Custom Stop by Clicking Map</label>
                        <input
                          type="text"
                          placeholder="Custom Stop Name"
                          className="text-input"
                          value={newStopName}
                          onChange={(e) => setNewStopName(e.target.value)}
                        />
                      </div>

                      <button
                        className={`btn ${isStopAddingMode ? 'btn-secondary' : 'btn-outline'}`}
                        style={{ width: '100%' }}
                        onClick={() => setIsStopAddingMode(!isStopAddingMode)}
                      >
                        {isStopAddingMode ? 'Click Map to Place Stop' : 'Declare Stop on Map'}
                      </button>
                    </div>

                    {stops.length > 0 && (
                      <div className="stops-list-container" style={{ borderTop: '1px solid var(--border-card)', paddingTop: '1rem', marginTop: '1rem' }}>
                        <span className="input-label">Stops List</span>
                        {stops.map((stop, idx) => (
                          <div key={stop.id} className="stop-item">
                            <div className="stop-info">
                              <span className="stop-number">{idx + 1}</span>
                              <div>
                                <div className="stop-name">{stop.name}</div>
                                <div className="stop-coordinates">
                                  {stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}
                                </div>
                              </div>
                            </div>
                            <button className="stop-delete-btn" onClick={() => handleDeleteStop(stop.id)}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Telemetry */}
                {driverCode && (
                  <div className="glass-card">
                    <h3>Telemetry (VIT Bhopal)</h3>
                    <div className="telemetry-grid">
                      <div className="telemetry-item">
                        <div className="telemetry-title">Latitude</div>
                        <div className="telemetry-value">
                          {simulationMode ? simulatedLocation?.lat.toFixed(5) : geoLat?.toFixed(5) || 'Searching...'}
                        </div>
                      </div>
                      <div className="telemetry-item">
                        <div className="telemetry-title">Longitude</div>
                        <div className="telemetry-value">
                          {simulationMode ? simulatedLocation?.lng.toFixed(5) : geoLng?.toFixed(5) || 'Searching...'}
                        </div>
                      </div>
                      <div className="telemetry-item">
                        <div className="telemetry-title">Simulate</div>
                        <div className="telemetry-value">
                          {simulationMode ? 'Active' : 'GPS Device'}
                        </div>
                      </div>
                      <div className="telemetry-item">
                        <div className="telemetry-title">Screen Lock</div>
                        <div className="telemetry-value" style={{ color: wakeLockActive || simulationMode ? 'var(--secondary)' : 'var(--text-muted)' }}>
                          {wakeLockActive || simulationMode ? 'Enabled' : 'Disabled'}
                        </div>
                      </div>
                    </div>
                    {geoError && (
                      <div style={{ color: 'var(--error)', fontSize: '0.85rem', marginTop: '0.75rem' }}>
                        Error: {geoError}
                      </div>
                    )}
                    {simulationMode && (
                      <div style={{ fontSize: '0.85rem', color: 'var(--accent)', marginTop: '0.75rem' }}>
                        💡 **Map Click Simulation**: Click anywhere on the VIT Bhopal map to move your van marker instantly.
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* STUDENT DASHBOARD */}
            {role === 'student' && (
              <>
                <div className="glass-card accent-border-secondary">
                  <h3>Track a Van</h3>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                    Enter the unique driver code shared by your van driver.
                  </p>

                  <form onSubmit={handleStudentTrack}>
                    <div className="input-group">
                      <label className="input-label">Enter Driver Code</label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input
                          type="text"
                          placeholder="e.g. VIT-A2D9"
                          className="text-input"
                          style={{ flex: 1, textTransform: 'uppercase', fontFamily: 'monospace', fontSize: '1.1rem', letterSpacing: '0.05em' }}
                          value={studentCodeInput}
                          onChange={(e) => setStudentCodeInput(e.target.value)}
                          disabled={!!driverCode}
                        />
                        {!driverCode ? (
                          <button type="submit" className="btn btn-secondary" style={{ padding: '0.75rem' }}>
                            <Search size={18} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-outline"
                            onClick={() => {
                              setDriverCode('');
                              setStudentCodeInput('');
                            }}
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </div>
                  </form>

                  {sessionError && (
                    <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--error)', padding: '0.75rem', borderRadius: '12px', color: 'var(--error)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                      <AlertCircle size={18} style={{ flexShrink: 0 }} />
                      <span>{sessionError}</span>
                    </div>
                  )}

                  {driverCode && currentSessionState && (
                    <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="input-label">Van Connection</span>
                      {currentSessionState.status === 'active' ? (
                        <div className="live-badge">
                          <span className="pulse-dot"></span> Live Tracking
                        </div>
                      ) : (
                        <div className="offline-badge">Driver Offline</div>
                      )}
                    </div>
                  )}
                </div>

                {driverCode && currentSessionState && (
                  <div className="glass-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <h3>Stops & Live ETAs</h3>
                      <button className="btn btn-outline" style={{ padding: '0.4rem' }} onClick={() => fetchSessionState(driverCode)}>
                        <RefreshCw size={14} />
                      </button>
                    </div>

                    {currentSessionState.status === 'inactive' && (
                      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        Driver is currently offline. Showing declared stop points. Dynamic ETAs will calculate once driver resumes streaming.
                      </p>
                    )}

                    {stops.length === 0 ? (
                      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        No stops have been declared for this driver session yet.
                      </p>
                    ) : (
                      <div className="stops-list-container">
                        {stops.map((stop, idx) => {
                          let distanceToVan: number | null = null;
                          let etaMinutes: number | null = null;

                          if (currentSessionState.lastLocation) {
                            distanceToVan = calculateDistance(
                              currentSessionState.lastLocation.lat,
                              currentSessionState.lastLocation.lng,
                              stop.lat,
                              stop.lng
                            );
                            
                            // Estimate arrival time assuming 20 km/h average speed inside college roads
                            const avgSpeedKmh = 20;
                            etaMinutes = Math.round((distanceToVan / avgSpeedKmh) * 60);
                          }

                          return (
                            <div key={stop.id} className="stop-item">
                              <div className="stop-info">
                                <span className="stop-number" style={{ background: 'var(--secondary-glow)', color: 'var(--secondary)' }}>
                                  {idx + 1}
                                </span>
                                <div>
                                  <div className="stop-name">{stop.name}</div>
                                  {distanceToVan !== null && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                      Distance: {distanceToVan.toFixed(2)} km
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              <div style={{ textAlign: 'right' }}>
                                {etaMinutes !== null ? (
                                  distanceToVan! < 0.05 ? (
                                    <span style={{ color: 'var(--success)', fontSize: '0.85rem', fontWeight: 'bold' }}>
                                      Arrived
                                    </span>
                                  ) : (
                                    <span style={{ color: 'var(--accent)', fontSize: '0.85rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                      <Clock size={12} /> {etaMinutes} min
                                    </span>
                                  )
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>--</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Relative distance to student */}
                {driverCode && currentSessionState?.lastLocation && studentGeoLocation && (
                  <div className="glass-card">
                    <h3>Van Distance to You</h3>
                    {(() => {
                      const dist = calculateDistance(
                        currentSessionState.lastLocation!.lat,
                        currentSessionState.lastLocation!.lng,
                        studentGeoLocation.lat,
                        studentGeoLocation.lng
                      );
                      const speedKmh = 20;
                      const eta = Math.round((dist / speedKmh) * 60);

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Distance:</span>
                            <span style={{ fontWeight: '700' }}>{dist.toFixed(2)} km</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>ETA:</span>
                            <span style={{ fontWeight: '700', color: 'var(--secondary)' }}>
                              {eta < 1 ? 'Approaching' : `${eta} mins`}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </>
            )}

            {/* Diagnostics footer */}
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <div>API Host: <code style={{ color: 'var(--text-secondary)' }}>{BACKEND_URL}</code></div>
              {isProdFallback && (
                <div style={{ color: 'var(--accent)', fontWeight: 600 }}>⚠️ warning: Using localhost API in production. Set VITE_BACKEND_URL on Vercel.</div>
              )}
            </div>
          </section>

          {/* Map Section */}
          <section style={{ position: 'relative', width: '100%', height: '100%' }}>
            <MapComponent
              vanLocation={
                role === 'driver'
                  ? (simulationMode
                      ? (simulatedLocation ? { lat: simulatedLocation.lat, lng: simulatedLocation.lng, timestamp: Date.now() } : null)
                      : (geoLat && geoLng ? { lat: geoLat, lng: geoLng, speed: geoSpeed || 0, timestamp: Date.now() } : null)
                    )
                  : (currentSessionState?.lastLocation || null)
              }
              stops={stops}
              studentLocation={role === 'student' ? studentGeoLocation : null}
              onAddStop={handleMapClick}
              enableStopAdding={role === 'driver' && (isStopAddingMode || simulationMode)}
              mapCenterOverride={mapCenterOverride}
              searchResults={searchResults}
              onSelectSearchResult={selectSearchResult}
              mapStyle={mapStyle}
            />

            {/* Map Style Toggle Button */}
            <button
              className="btn btn-outline"
              style={{
                position: 'absolute',
                bottom: '25px',
                left: '20px',
                zIndex: 1000,
                padding: '0.5rem 0.85rem',
                fontSize: '0.8rem',
                background: 'rgba(9, 13, 22, 0.85)',
                border: '1px solid var(--border-card)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontWeight: 600,
                boxShadow: 'var(--shadow-md)'
              }}
              onClick={() => setMapStyle(mapStyle === 'roadmap' ? 'satellite' : 'roadmap')}
            >
              🗺️ {mapStyle === 'roadmap' ? 'Satellite View' : 'Standard View'}
            </button>

            {/* Float HUD */}
            <div style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              zIndex: 1000,
              pointerEvents: 'none'
            }}>
              <div className="glass-card" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: isCurrentlyTracking ? 'var(--success)' : 'var(--error)',
                  boxShadow: isCurrentlyTracking ? '0 0 8px var(--success)' : 'none'
                }}></div>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {role === 'driver' 
                    ? (isCurrentlyTracking ? `Broadcasting: ${driverCode}` : 'Not Broadcasting')
                    : (currentSessionState?.status === 'active' ? `Tracking: ${driverCode}` : 'Driver Offline')
                  }
                </span>
              </div>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

export default App;

// Fix: Safari Geolocation permission click gesture fix
