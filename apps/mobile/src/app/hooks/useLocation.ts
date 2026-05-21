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
    // iOS permissions are handled via Info.plist prompt automatically
    return true;
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
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    const fetchLocation = async () => {
      const permitted = await hasLocationPermission();

      if (!permitted) {
        if (isMounted.current) {
          setError('Location permission denied');
          setLoading(false);
        }
        return;
      }

      Geolocation.getCurrentPosition(
        (position) => {
          if (isMounted.current) {
            setLocation({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            });
            setError(null);
            setLoading(false);
          }
        },
        (err) => {
          if (isMounted.current) {
            setError(err.message);
            setLoading(false);
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
        },
      );
    };

    fetchLocation();

    return () => {
      isMounted.current = false;
    };
  }, []);

  return { location, error, loading };
}
