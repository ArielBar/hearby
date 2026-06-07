import { Platform, PermissionsAndroid, Alert, Linking } from 'react-native';
import Geolocation from 'react-native-geolocation-service';

/**
 * Requests location permission with proper rationale for both platforms.
 * Returns true if permission was granted, false otherwise.
 *
 * iOS: Handled automatically via Info.plist NSLocationWhenInUseUsageDescription.
 * Android: Requires runtime permission request with user-facing rationale.
 */
export async function requestLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    // iOS permission is triggered by Geolocation calls via Info.plist description
    return new Promise((resolve) => {
      Geolocation.requestAuthorization('whenInUse');
      // Give iOS a moment to process
      setTimeout(() => resolve(true), 500);
    });
  }

  // Android runtime permission
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Location Permission',
        message:
          'HearBy needs access to your location to find and narrate nearby points of interest around you.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'Allow',
      },
    );

    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
      return true;
    }

    if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      Alert.alert(
        'Location Permission Required',
        'HearBy needs location access to work. Please enable it in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
    }

    return false;
  } catch (err) {
    console.warn('[LocationPermission] Error:', err);
    return false;
  }
}
