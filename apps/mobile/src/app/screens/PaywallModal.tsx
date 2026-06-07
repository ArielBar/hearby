import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Purchases, { PurchasesPackage } from 'react-native-purchases';
import { usePremium } from '../context/PremiumContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PREMIUM_ENTITLEMENT = 'ad_free_premium';

const BENEFITS = [
  { emoji: '🚫', text: 'חוויה חלקה ללא פרסומות' },
  { emoji: '🌍', text: 'תמיכה מלאה ב-11 שפות' },
  { emoji: '🎧', text: 'איכות שמע פרימיום אנושית' },
  { emoji: '⚡', text: 'גישה מיידית לתוכן ללא המתנה' },
];

interface PaywallModalProps {
  visible: boolean;
  onClose: () => void;
}

export function PaywallModal({ visible, onClose }: PaywallModalProps) {
  const { isPremium } = usePremium();
  const [availablePackage, setAvailablePackage] = useState<PurchasesPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Fetch offerings from RevenueCat
  useEffect(() => {
    if (!visible) return;

    const fetchOfferings = async () => {
      try {
        setLoading(true);
        const offerings = await Purchases.getOfferings();
        const current = offerings.current;
        if (current) {
          // Prefer annual, fallback to monthly, fallback to first available
          const pkg =
            current.annual ?? current.monthly ?? current.availablePackages[0] ?? null;
          setAvailablePackage(pkg);
        }
      } catch (e) {
        console.warn('RevenueCat: Failed to fetch offerings', e);
      } finally {
        setLoading(false);
      }
    };

    fetchOfferings();
  }, [visible]);

  // Auto-dismiss if user becomes premium
  useEffect(() => {
    if (isPremium && visible) {
      setSuccessMessage('🎉 ברוכים הבאים ל-Premium!');
      setTimeout(() => {
        setSuccessMessage('');
        onClose();
      }, 2000);
    }
  }, [isPremium, visible, onClose]);

  const handlePurchase = useCallback(async () => {
    if (!availablePackage) return;

    try {
      setPurchasing(true);
      const { customerInfo } = await Purchases.purchasePackage(availablePackage);
      if (customerInfo.entitlements.active[PREMIUM_ENTITLEMENT]) {
        setSuccessMessage('🎉 ברוכים הבאים ל-Premium!');
        setTimeout(() => {
          setSuccessMessage('');
          onClose();
        }, 2000);
      }
    } catch (e: any) {
      if (!e.userCancelled) {
        console.warn('Purchase error:', e);
      }
    } finally {
      setPurchasing(false);
    }
  }, [availablePackage, onClose]);

  const handleRestore = useCallback(async () => {
    try {
      setRestoring(true);
      const customerInfo = await Purchases.restorePurchases();
      if (customerInfo.entitlements.active[PREMIUM_ENTITLEMENT]) {
        setSuccessMessage('✅ המנוי שוחזר בהצלחה!');
        setTimeout(() => {
          setSuccessMessage('');
          onClose();
        }, 2000);
      }
    } catch (e) {
      console.warn('Restore error:', e);
    } finally {
      setRestoring(false);
    }
  }, [onClose]);

  const priceLabel = availablePackage?.product.priceString ?? '—';
  const periodLabel = availablePackage?.packageType === 'ANNUAL' ? '/ שנה' : '/ חודש';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.container}>
        {/* Close button */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>

        {/* Success overlay */}
        {successMessage ? (
          <View style={styles.successOverlay}>
            <Text style={styles.successText}>{successMessage}</Text>
          </View>
        ) : null}

        {/* Crown icon */}
        <View style={styles.crownContainer}>
          <Image
            source={require('../assets/premium-icon.png')}
            style={styles.crownImage}
          />
        </View>

        {/* Title */}
        <Text style={styles.title}>Hearby Premium</Text>
        <Text style={styles.subtitle}>חווית הסיור המושלמת — ללא הפרעות</Text>

        {/* Benefits list */}
        <View style={styles.benefitsContainer}>
          {BENEFITS.map((benefit, index) => (
            <View key={index} style={styles.benefitRow}>
              <Text style={styles.benefitEmoji}>{benefit.emoji}</Text>
              <Text style={styles.benefitText}>{benefit.text}</Text>
            </View>
          ))}
        </View>

        {/* Pricing + CTA */}
        <View style={styles.ctaContainer}>
          {loading ? (
            <ActivityIndicator size="large" color="#A78BFA" />
          ) : (
            <>
              <TouchableOpacity
                style={[styles.purchaseBtn, purchasing && styles.purchaseBtnDisabled]}
                onPress={handlePurchase}
                disabled={purchasing || !availablePackage}
                activeOpacity={0.85}
              >
                {purchasing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.purchaseBtnText}>
                    התחל עכשיו — {priceLabel} {periodLabel}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.restoreBtn}
                onPress={handleRestore}
                disabled={restoring}
              >
                <Text style={styles.restoreBtnText}>
                  {restoring ? 'משחזר...' : 'שחזור רכישות קודמות'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Legal */}
        <Text style={styles.legal}>
          התשלום יחויב דרך חשבון ה-{Platform.OS === 'ios' ? 'Apple' : 'Google'} שלך.
          {'\n'}ניתן לבטל בכל עת דרך הגדרות המנוי.
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0B2E',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  closeBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 20,
    right: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  successOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,11,46,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  successText: {
    fontSize: 24,
    color: '#fff',
    fontWeight: '700',
    textAlign: 'center',
  },
  crownContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(167,139,250,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    marginTop: 20,
  },
  crownImage: {
    width: 60,
    height: 60,
    resizeMode: 'contain',
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#A78BFA',
    fontWeight: '500',
    marginBottom: 32,
    textAlign: 'center',
  },
  benefitsContainer: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
  },
  benefitRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 14,
  },
  benefitEmoji: {
    fontSize: 20,
    marginLeft: 12,
  },
  benefitText: {
    flex: 1,
    fontSize: 16,
    color: '#E2E8F0',
    fontWeight: '500',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  ctaContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  purchaseBtn: {
    width: '100%',
    height: 56,
    borderRadius: 16,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  purchaseBtnDisabled: {
    opacity: 0.6,
  },
  purchaseBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    writingDirection: 'rtl',
  },
  restoreBtn: {
    marginTop: 16,
    paddingVertical: 10,
  },
  restoreBtnText: {
    color: '#A78BFA',
    fontSize: 14,
    fontWeight: '500',
  },
  legal: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 40 : 24,
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: 20,
    writingDirection: 'rtl',
  },
});
