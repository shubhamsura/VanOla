import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Stop, Location } from '../hooks/useSocket';

// Custom modern SVG icons
const createVanIcon = () => {
  return L.divIcon({
    html: `
      <div style="
        width: 36px;
        height: 36px;
        background: #6366f1;
        border: 3px solid #ffffff;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 15px rgba(99, 102, 241, 0.6);
        animation: van-glow-pulse 2s infinite;
      ">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 18H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"></path>
          <path d="M14 6v12"></path>
          <circle cx="7.5" cy="18.5" r="2.5"></circle>
          <circle cx="16.5" cy="18.5" r="2.5"></circle>
          <path d="M18 16h4v-3h-4Z"></path>
        </svg>
      </div>
      <style>
        @keyframes van-glow-pulse {
          0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.8); }
          70% { box-shadow: 0 0 0 14px rgba(99, 102, 241, 0); }
          100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
        }
      </style>
    `,
    className: 'custom-van-icon',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
};

const createStopIcon = (number: number) => {
  return L.divIcon({
    html: `
      <div style="
        width: 28px;
        height: 28px;
        background: #14b8a6;
        border: 2px solid #ffffff;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-weight: 700;
        font-size: 11px;
        box-shadow: 0 4px 10px rgba(20, 184, 166, 0.4);
      ">
        ${number}
      </div>
    `,
    className: 'custom-stop-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
};

const createStudentIcon = () => {
  return L.divIcon({
    html: `
      <div style="
        width: 20px;
        height: 20px;
        background: #0ea5e9;
        border: 2.5px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 0 10px rgba(14, 165, 233, 0.8);
        animation: student-glow-pulse 2s infinite;
      ">
      </div>
      <style>
        @keyframes student-glow-pulse {
          0% { box-shadow: 0 0 0 0 rgba(14, 165, 233, 0.8); }
          70% { box-shadow: 0 0 0 10px rgba(14, 165, 233, 0); }
          100% { box-shadow: 0 0 0 0 rgba(14, 165, 233, 0); }
        }
      </style>
    `,
    className: 'custom-student-icon',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
};

const createSearchMarkerIcon = () => {
  return L.divIcon({
    html: `
      <div style="
        width: 24px;
        height: 24px;
        background: #ef4444;
        border: 2px solid #ffffff;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(239, 68, 68, 0.5);
      ">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      </div>
    `,
    className: 'custom-search-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

// Component to handle auto-centering when coordinates change
interface CenterHandlerProps {
  center: [number, number] | null;
  vanLocation: Location | null;
  onUserInteract?: () => void;
}

const ChangeMapView: React.FC<CenterHandlerProps> = ({ center, vanLocation, onUserInteract }) => {
  const map = useMap();
  const lastCenterRef = React.useRef<string | null>(null);
  const [hasCenteredOnVan, setHasCenteredOnVan] = React.useState(false);

  useEffect(() => {
    if (!vanLocation) {
      setHasCenteredOnVan(false);
    }
  }, [vanLocation]);

  // Listen for user manual drag/zoom/move gestures to release camera lock
  useMapEvents({
    dragstart() {
      if (onUserInteract) onUserInteract();
    },
    zoomstart() {
      if (onUserInteract) onUserInteract();
    },
    movestart() {
      if (onUserInteract) onUserInteract();
    }
  });

  // Smoothly set map view ONLY when center coordinates change to a new location
  useEffect(() => {
    if (center) {
      const centerKey = `${center[0].toFixed(5)},${center[1].toFixed(5)}`;
      if (lastCenterRef.current !== centerKey) {
        lastCenterRef.current = centerKey;
        map.setView(center, Math.max(map.getZoom(), 15), { animate: true });
      }
    } else if (vanLocation && !hasCenteredOnVan) {
      map.setView([vanLocation.lat, vanLocation.lng], 15, { animate: true });
      setHasCenteredOnVan(true);
    }
  }, [center, vanLocation, hasCenteredOnVan, map]);

  return null;
};

// Custom floating map button to re-center on the van manually
const MapControls: React.FC<{ vanLocation: Location | null; onCenterVan?: () => void }> = ({ vanLocation, onCenterVan }) => {
  const map = useMap();
  if (!vanLocation) return null;
  
  return (
    <button
      className="btn btn-outline"
      style={{
        position: 'absolute',
        top: '80px',
        left: '10px',
        zIndex: 1000,
        padding: '0.45rem 0.75rem',
        fontSize: '0.75rem',
        background: 'rgba(9, 13, 22, 0.85)',
        border: '1px solid var(--border-card)',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '0.3rem',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        fontWeight: 700,
        boxShadow: 'var(--shadow-md)',
        pointerEvents: 'auto'
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (onCenterVan) onCenterVan();
        map.setView([vanLocation.lat, vanLocation.lng], Math.max(map.getZoom(), 15), { animate: true });
      }}
    >
      🎯 Center on Van
    </button>
  );
};

// Component to handle map clicks for adding stops
interface MapClickHandlerProps {
  onMapClick?: (lat: number, lng: number) => void;
  enabled: boolean;
}

const MapClickHandler: React.FC<MapClickHandlerProps> = ({ onMapClick, enabled }) => {
  useMapEvents({
    click(e) {
      if (enabled && onMapClick) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
};

interface MapComponentProps {
  vanLocation: Location | null;
  stops: Stop[];
  studentLocation: { lat: number; lng: number } | null;
  onAddStop?: (lat: number, lng: number) => void;
  enableStopAdding?: boolean;
  mapCenterOverride?: [number, number] | null;
  onClearCenterOverride?: () => void;
  searchResults?: any[];
  onSelectSearchResult?: (result: any) => void;
  mapStyle?: 'roadmap' | 'satellite';
}

export const MapComponent: React.FC<MapComponentProps> = ({
  vanLocation,
  stops,
  studentLocation,
  onAddStop,
  enableStopAdding = false,
  mapCenterOverride = null,
  onClearCenterOverride,
  searchResults = [],
  onSelectSearchResult,
  mapStyle = 'roadmap',
}) => {
  // Determine default center: van location, student location, first stop, or fallback (VIT Bhopal)
  const getInitialCenter = (): [number, number] => {
    if (mapCenterOverride) return mapCenterOverride;
    if (vanLocation) return [vanLocation.lat, vanLocation.lng];
    if (studentLocation) return [studentLocation.lat, studentLocation.lng];
    if (stops.length > 0) return [stops[0].lat, stops[0].lng];
    return [23.0772, 76.8513]; // Default VIT Bhopal coordinates
  };

  const centerCoords = getInitialCenter();

  const [roadPolylinePositions, setRoadPolylinePositions] = React.useState<[number, number][]>([]);

  // Fetch actual driving road coordinates from OSRM routing engine (Google Maps style road tracing)
  useEffect(() => {
    const points: { lat: number; lng: number }[] = [];
    if (vanLocation) {
      points.push({ lat: vanLocation.lat, lng: vanLocation.lng });
    }
    stops.forEach((s) => points.push({ lat: s.lat, lng: s.lng }));

    if (points.length < 2) {
      setRoadPolylinePositions([]);
      return;
    }

    const fallbackStraight: [number, number][] = points.map((p) => [p.lat, p.lng]);

    // Format OSRM coordinates: lon,lat;lon,lat...
    const coordsString = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`;

    const controller = new AbortController();
    fetch(osrmUrl, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.routes && data.routes.length > 0 && data.routes[0].geometry) {
          const rawCoords = data.routes[0].geometry.coordinates; // [[lon, lat], ...]
          const formatted: [number, number][] = rawCoords.map((c: [number, number]) => [c[1], c[0]]);
          setRoadPolylinePositions(formatted);
        } else {
          setRoadPolylinePositions(fallbackStraight);
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setRoadPolylinePositions(fallbackStraight);
        }
      });

    return () => controller.abort();
  }, [vanLocation?.lat, vanLocation?.lng, stops]);

  return (
    <div className="map-container-wrapper" style={{ height: '100%', width: '100%', borderRadius: '18px', overflow: 'hidden' }}>
      <MapContainer
        center={centerCoords}
        zoom={14}
        scrollWheelZoom={true}
        markerZoomAnimation={false}
        style={{ height: '100%', width: '100%' }}
      >
        {/* Google Maps Road Tile Layer - Displays real landmarks, footprints, shops and streets */}
        <TileLayer
          attribution='&copy; Google Maps'
          url={
            mapStyle === 'satellite'
              ? "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
              : "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
          }
        />

        {/* Active Driving Route Path (Following Actual Roads via OSRM) */}
        {roadPolylinePositions.length >= 2 && (
          <Polyline
            positions={roadPolylinePositions}
            pathOptions={{
              color: '#1A73E8', // Official Google Maps Navigation Blue
              weight: 6,
              opacity: 0.85,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        )}

        {/* Change map view helper */}
        <ChangeMapView 
          center={mapCenterOverride} 
          vanLocation={vanLocation}
          onUserInteract={onClearCenterOverride}
        />

        {/* Custom manual map controls (e.g. Center on Van button) */}
        <MapControls vanLocation={vanLocation} onCenterVan={onClearCenterOverride} />

        {/* Click handler helper */}
        <MapClickHandler onMapClick={onAddStop} enabled={enableStopAdding} />

        {/* Student Location Marker */}
        {studentLocation && (
          <Marker position={[studentLocation.lat, studentLocation.lng]} icon={createStudentIcon()}>
            <Popup>
              <strong>You</strong><br />
              Your current position.
            </Popup>
          </Marker>
        )}

        {/* Van Marker */}
        {vanLocation && (
          <Marker position={[vanLocation.lat, vanLocation.lng]} icon={createVanIcon()}>
            <Popup>
              <strong>College Van (Live)</strong><br />
              {vanLocation.speed ? `Speed: ${(vanLocation.speed * 3.6).toFixed(1)} km/h` : 'Moving'}
            </Popup>
          </Marker>
        )}

        {/* Stop Markers */}
        {stops.map((stop, index) => (
          <Marker key={stop.id} position={[stop.lat, stop.lng]} icon={createStopIcon(index + 1)}>
            <Popup>
              <strong>Stop {index + 1}: {stop.name}</strong><br />
              Lat: {stop.lat.toFixed(5)}, Lng: {stop.lng.toFixed(5)}
            </Popup>
          </Marker>
        ))}
        {/* Search Result Markers (Red Search Pins) */}
        {searchResults.map((result: any) => (
          <Marker
            key={result.place_id}
            position={[parseFloat(result.lat), parseFloat(result.lon)]}
            icon={createSearchMarkerIcon()}
          >
            <Popup>
              <div style={{ padding: '0.25rem', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
                <strong style={{ fontSize: '0.95rem', display: 'block', marginBottom: '0.25rem' }}>
                  {result.display_name.split(',')[0]}
                </strong>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', lineHeight: '1.3' }}>
                  {result.display_name}
                </p>
                {onSelectSearchResult && (
                  <button
                    className="btn btn-primary"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', width: '100%', cursor: 'pointer' }}
                    onClick={() => onSelectSearchResult(result)}
                  >
                    Add Stop Point
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};
