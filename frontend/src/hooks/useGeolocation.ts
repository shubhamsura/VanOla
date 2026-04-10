import { useState, useEffect, useRef } from 'react';

interface GeolocationState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  speed: number | null; // in m/s
  error: string | null;
  isWatching: boolean;
  wakeLockActive: boolean;
}

export const useGeolocation = () => {
  const [state, setState] = useState<GeolocationState>({
    lat: null,
    lng: null,
    accuracy: null,
    speed: null,
    error: null,
    isWatching: false,
    wakeLockActive: false,
  });

  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any | null>(null); // WakeLockSentinel

  // Request screen wake lock to prevent the phone screen from sleeping
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        const sentinel = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current = sentinel;
        setState((prev) => ({ ...prev, wakeLockActive: true }));
        console.log('Screen Wake Lock activated');

        sentinel.addEventListener('release', () => {
          setState((prev) => ({ ...prev, wakeLockActive: false }));
          console.log('Screen Wake Lock released');
        });
      } catch (err: any) {
        console.warn('Failed to acquire wake lock:', err.message);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        setState((prev) => ({ ...prev, wakeLockActive: false }));
      } catch (err: any) {
        console.error('Failed to release wake lock:', err.message);
      }
    }
  };

  const startWatching = (options: PositionOptions = { enableHighAccuracy: true, maximumAge: 0 }) => {
    if (!navigator.geolocation) {
      setState((prev) => ({ ...prev, error: 'Geolocation is not supported by your browser' }));
      return;
    }

    if (watchIdRef.current !== null) return;

    // Request wake lock for drivers
    requestWakeLock();

    const successHandler = (position: GeolocationPosition) => {
      setState({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        speed: position.coords.speed, // speed in m/s (can be null)
        error: null,
        isWatching: true,
        wakeLockActive: !!wakeLockRef.current,
      });
    };

    const errorHandler = (error: GeolocationPositionError) => {
      setState((prev) => ({
        ...prev,
        error: error.message,
        isWatching: false,
      }));
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      successHandler,
      errorHandler,
      options
    );
  };

  const stopWatching = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    releaseWakeLock();
    setState((prev) => ({
      ...prev,
      isWatching: false,
    }));
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
      }
    };
  }, []);

  return {
    ...state,
    startWatching,
    stopWatching,
  };
};
export type { GeolocationState };
