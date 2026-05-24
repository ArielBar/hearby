import { useEffect, useState, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from 'react-native-geolocation-service';

export interface LocationCoords {
  lat: number;
  lng: number;
}

export interface UseLocationResult {
  location: LocationCoords | null;
  error: string | null;
  loading: boolean;
}

async function requestAndroidPermission(): Promise<boolean> {
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Location Permission',
      message: 'This app needs access to your location to show nearby places.',
      buttonPositiveLabel: 'Allow',
      buttonNegativeLabel: 'Deny',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

async function hasLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const status = await Geolocation.requestAuthorization('whenInUse');
    return status === 'granted' || status === 'disabled';
  }

  if (Platform.OS === 'android') {
    return requestAndroidPermission();
  }

  return false;
}

export function useLocation(): UseLocationResult {
  const [location, setLocation] = useState<LocationCoords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    const startWatching = async () => {
      const permitted = await hasLocationPermission();

      if (!permitted) {
        if (mounted) {
          setError('Location permission denied');
          setLoading(false);
        }
        return;
      }

      watchId.current = Geolocation.watchPosition(
        (position) => {
          if (mounted) {
            setLocation({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            });
            setError(null);
            setLoading(false);
          }
        },
        (err) => {
          if (mounted) {
            setError(err.message);
            setLoading(false);
          }
        },
        {
          enableHighAccuracy: true,
          distanceFilter: 50,
          interval: 10000,
          fastestInterval: 5000,
        },
      );
    };

    startWatching();

    return () => {
      mounted = false;
      if (watchId.current !== null) {
        Geolocation.clearWatch(watchId.current);
      }
    };
  }, []);

  return { location, error, loading };
}
