import { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import mobileAds from 'react-native-google-mobile-ads';
import { FeatureFlags } from './config/featureFlags';
import { PremiumProvider } from './context/PremiumContext';
import { NearbyPoisScreen } from './screens/NearbyPoisScreen';

export type RootStackParamList = {
  NearbyPois: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const queryClient = new QueryClient();

export const App = () => {
  useEffect(() => {
    if (!FeatureFlags.ENABLE_ADS) return;
    mobileAds()
      .initialize()
      .then((adapterStatuses) => {
        console.log('AdMob initialized:', adapterStatuses);
      });
  }, []);

  return (
    <SafeAreaProvider>
      <PremiumProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar barStyle="dark-content" />
          <NavigationContainer>
            <Stack.Navigator
              initialRouteName="NearbyPois"
              screenOptions={{ headerShown: false }}
            >
              <Stack.Screen name="NearbyPois" component={NearbyPoisScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        </QueryClientProvider>
      </PremiumProvider>
    </SafeAreaProvider>
  );
};

export default App;
