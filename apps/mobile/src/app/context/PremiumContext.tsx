import React, { createContext, useContext, useEffect, useState } from 'react';
import Purchases, { CustomerInfo, LOG_LEVEL } from 'react-native-purchases';
import { Platform } from 'react-native';
import { FeatureFlags } from '../config/featureFlags';

const REVENUECAT_IOS_KEY = 'REVENUECAT_IOS_KEY';
const REVENUECAT_ANDROID_KEY = 'REVENUECAT_ANDROID_KEY';

// The entitlement identifier configured in RevenueCat dashboard
const PREMIUM_ENTITLEMENT = 'ad_free_premium';

interface PremiumContextType {
  isPremium: boolean;
  customerInfo: CustomerInfo | null;
  loading: boolean;
  restorePurchases: () => Promise<void>;
}

const PremiumContext = createContext<PremiumContextType>({
  isPremium: false,
  customerInfo: null,
  loading: true,
  restorePurchases: async () => {},
});

export const usePremium = () => useContext(PremiumContext);

export const PremiumProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isPremium, setIsPremium] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [loading, setLoading] = useState(!FeatureFlags.ENABLE_PURCHASES);

  useEffect(() => {
    // Skip RevenueCat entirely when purchases are disabled
    if (!FeatureFlags.ENABLE_PURCHASES) {
      setLoading(false);
      return;
    }

    const initPurchases = async () => {
      if (__DEV__) {
        Purchases.setLogLevel(LOG_LEVEL.DEBUG);
      }

      if (Platform.OS === 'ios') {
        Purchases.configure({ apiKey: REVENUECAT_IOS_KEY });
      } else {
        Purchases.configure({ apiKey: REVENUECAT_ANDROID_KEY });
      }

      // Fetch initial customer info
      try {
        const info = await Purchases.getCustomerInfo();
        updatePremiumStatus(info);
      } catch (e) {
        console.warn('RevenueCat: Failed to fetch customer info', e);
      } finally {
        setLoading(false);
      }
    };

    initPurchases();

    // Listen for subscription status changes
    const listener = Purchases.addCustomerInfoUpdateListener((info) => {
      updatePremiumStatus(info);
    });

    return () => {
      listener.remove();
    };
  }, []);

  const updatePremiumStatus = (info: CustomerInfo) => {
    setCustomerInfo(info);
    const hasEntitlement =
      info.entitlements.active[PREMIUM_ENTITLEMENT] !== undefined;
    setIsPremium(hasEntitlement);
  };

  const restorePurchases = async () => {
    if (!FeatureFlags.ENABLE_PURCHASES) return;
    try {
      const info = await Purchases.restorePurchases();
      updatePremiumStatus(info);
    } catch (e) {
      console.warn('RevenueCat: Restore failed', e);
    }
  };

  return (
    <PremiumContext.Provider value={{ isPremium, customerInfo, loading, restorePurchases }}>
      {children}
    </PremiumContext.Provider>
  );
};
