import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

interface Location {
  lat: number;
  lng: number;
  speed?: number;
  timestamp: number;
}

interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface Session {
  driverCode: string;
  status: 'active' | 'inactive';
  stops: Stop[];
  lastLocation?: Location;
}

export const useSocket = () => {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentSessionState, setCurrentSessionState] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Callbacks for live updates
  const [onLocationUpdateCallback, setOnLocationUpdateCallback] = useState<
    ((data: { driverCode: string; location: Location; stops: Stop[] }) => void) | null
  >(null);
  const [onSessionStoppedCallback, setOnSessionStoppedCallback] = useState<
    ((data: { driverCode: string }) => void) | null
  >(null);

  // Initialize Socket connection
  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      setSessionError(null);
      console.log('Connected to websocket server');
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log('Disconnected from websocket server');
    });

    // Listen for room session states
    socket.on('session-state', (state: Session) => {
      setCurrentSessionState(state);
      setSessionError(null);
    });

    socket.on('session-updated', (state: Session) => {
      setCurrentSessionState(state);
    });

    socket.on('session-error', (err: { message: string }) => {
      setSessionError(err.message);
      setCurrentSessionState(null);
    });

    // Listen for dynamic location changes
    socket.on('location-updated', (data: { driverCode: string; location: Location; stops: Stop[] }) => {
      if (onLocationUpdateCallback) {
        onLocationUpdateCallback(data);
      }
      
      setCurrentSessionState((prev) => {
        if (prev && prev.driverCode === data.driverCode) {
          return {
            ...prev,
            lastLocation: data.location,
            stops: data.stops,
          };
        }
        return prev;
      });
    });

    // Listen for stopped session events
    socket.on('session-stopped', (data: { driverCode: string }) => {
      if (onSessionStoppedCallback) {
        onSessionStoppedCallback(data);
      }
      
      setCurrentSessionState((prev) => {
        if (prev && prev.driverCode === data.driverCode) {
          return {
            ...prev,
            status: 'inactive',
            lastLocation: undefined,
          };
        }
        return prev;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [onLocationUpdateCallback, onSessionStoppedCallback]);

  // Join a driver code session room
  const joinSession = useCallback((driverCode: string, role: 'driver' | 'student') => {
    if (socketRef.current && isConnected) {
      const upperCode = driverCode.toUpperCase();
      socketRef.current.emit('join-session', { driverCode: upperCode, role });
    }
  }, [isConnected]);

  // Send driver coordinates
  const updateLocation = useCallback((driverCode: string, lat: number, lng: number, speed?: number | null, stops?: Stop[]) => {
    if (socketRef.current && isConnected) {
      const upperCode = driverCode.toUpperCase();
      socketRef.current.emit('update-location', {
        driverCode: upperCode,
        lat,
        lng,
        speed: speed || undefined,
        stops,
      });
    }
  }, [isConnected]);

  // Stop tracking session
  const stopSession = useCallback((driverCode: string) => {
    if (socketRef.current && isConnected) {
      const upperCode = driverCode.toUpperCase();
      socketRef.current.emit('stop-session', { driverCode: upperCode });
      setCurrentSessionState(null);
    }
  }, [isConnected]);

  // HTTP API: Create a session (generates driver code automatically)
  const createSession = useCallback(async (stops: Stop[]): Promise<Session | null> => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stops }),
      });
      
      if (response.ok) {
        const newSession = await response.json();
        return newSession;
      }
    } catch (err) {
      console.error('Failed to create tracking session:', err);
    }
    return null;
  }, []);

  // HTTP API: Get status of a session
  const fetchSessionState = useCallback(async (driverCode: string): Promise<Session | null> => {
    try {
      const upperCode = driverCode.toUpperCase();
      const response = await fetch(`${BACKEND_URL}/api/sessions/${upperCode}`);
      if (response.ok) {
        const data = await response.json();
        setSessionError(null);
        return data;
      } else {
        const errorData = await response.json();
        setSessionError(errorData.error || 'Driver session not found');
      }
    } catch (err) {
      console.error('Failed to fetch session state:', err);
      setSessionError('Network error connecting to tracking server');
    }
    return null;
  }, []);

  const registerLocationListener = useCallback((cb: (data: { driverCode: string; location: Location; stops: Stop[] }) => void) => {
    setOnLocationUpdateCallback(() => cb);
  }, []);

  const registerSessionStoppedListener = useCallback((cb: (data: { driverCode: string }) => void) => {
    setOnSessionStoppedCallback(() => cb);
  }, []);

  return {
    isConnected,
    currentSessionState,
    sessionError,
    setSessionError,
    joinSession,
    updateLocation,
    stopSession,
    createSession,
    fetchSessionState,
    registerLocationListener,
    registerSessionStoppedListener,
  };
};

export type { Session, Stop, Location };
