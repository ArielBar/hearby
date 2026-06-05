import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  Modal,
  NativeEventEmitter,
  NativeModules,
  SafeAreaView,
  Settings,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
const { HearbyTts } = NativeModules;
const ttsEmitter = new NativeEventEmitter(HearbyTts);
const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PANEL_MAX_HEIGHT = SCREEN_HEIGHT * 0.55;

// Backend API call
const BASE_URL = 'http://localhost:3000/api';

const LANG_FLAGS: Record<string, string> = {
  en: '🇬🇧', he: '🇮🇱', es: '🇪🇸', fr: '🇫🇷', de: '🇩🇪',
  it: '🇮🇹', pt: '🇵🇹', ar: '🇸🇦', ru: '🇷🇺', ja: '🇯🇵',
  zh: '🇨🇳', ko: '🇰🇷', nl: '🇳🇱', pl: '🇵🇱', tr: '🇹🇷',
  th: '🇹🇭', hi: '🇮🇳', sv: '🇸🇪', da: '🇩🇰', fi: '🇫🇮',
  no: '🇳🇴', uk: '🇺🇦', el: '🇬🇷', cs: '🇨🇿', ro: '🇷🇴',
  hu: '🇭🇺', id: '🇮🇩', ms: '🇲🇾', vi: '🇻🇳',
};

/**
 * Get preferred languages from device settings (iOS: AppleLanguages)
 * Returns array of {code, label} based on the user's language preferences
 */
function getDevicePreferredLanguages(): { code: string; label: string }[] {
  try {
    const appleLanguages: string[] | undefined =
      Settings.get('AppleLanguages') as string[] | undefined;

    if (appleLanguages && appleLanguages.length > 0) {
      const seen = new Set<string>();
      return appleLanguages
        .map(locale => locale.split('_')[0].split('-')[0].toLowerCase())
        .filter(code => {
          if (seen.has(code)) return false;
          seen.add(code);
          return true;
        })
        .map(code => ({
          code,
          label: `${LANG_FLAGS[code] || '🌐'} ${code.toUpperCase()}`,
        }));
    }
  } catch {
    // Settings API not available
  }
  // Fallback
  return [
    { code: 'he', label: '🇮🇱 HE' },
    { code: 'en', label: '🇬🇧 EN' },
  ];
}

/**
 * Detect device language (first preferred language)
 */
function getDeviceLanguage(): string {
  const langs = getDevicePreferredLanguages();
  return langs[0]?.code || 'en';
}

interface EnrichResult {
  name: string;
  masterScript: string;
}

interface Coordinate {
  latitude: number;
  longitude: number;
}

interface AutocompleteResult {
  title: string;
  description: string;
  lat: number | null;
  lng: number | null;
  type: 'city' | 'poi';
}

/**
 * Fetch POI enrichment by coordinates
 * Server will search Wikipedia for POIs near these coordinates
 */
async function fetchPoiEnrichment(
  coordinate: Coordinate,
  lang: string,
): Promise<EnrichResult | null> {
  const params = new URLSearchParams({
    lat: coordinate.latitude.toString(),
    lng: coordinate.longitude.toString(),
    lang,
  });
  const res = await fetch(`${BASE_URL}/pois/enrich?${params}`);

  if (res.status === 204 || !res.ok) {
    return null;
  }

  return res.json();
}

/**
 * Fetch autocomplete suggestions using backend proxy to Nominatim
 * Backend handles the Nominatim API call, avoiding iOS ATS issues
 * Provides native, multilingual worldwide search
 */
async function fetchAutocomplete(
  query: string,
  language: string,
): Promise<AutocompleteResult[]> {
  if (!query || query.trim().length < 2) {
    return [];
  }

  try {
    // Call our backend proxy endpoint instead of Nominatim directly
    const params = new URLSearchParams({
      query: query.trim(),
      lang: language,
    });

    const res = await fetch(
      `${BASE_URL}/search/nominatim?${params}`
    );

    if (!res.ok) {
      console.warn('[Autocomplete] Backend proxy request failed:', res.status);
      return [];
    }

    const results = await res.json();
    return Array.isArray(results) ? results : [];
  } catch (error) {
    console.error('[Autocomplete] Failed to fetch from backend proxy:', error);
    return [];
  }
}

export function NearbyPoisScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  // Detect device language once on mount (for Nominatim accept-language header)
  const [deviceLanguage, setDeviceLanguage] = useState(() => getDeviceLanguage());
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [preferredLanguages] = useState(() => getDevicePreferredLanguages());

  // Load persisted language preference on mount
  useEffect(() => {
    AsyncStorage.getItem('hearby_lang').then(saved => {
      if (saved) setDeviceLanguage(saved);
    });
  }, []);

  // Persist language when user changes it
  const handleLanguageChange = useCallback((code: string) => {
    setDeviceLanguage(code);
    setShowLangPicker(false);
    AsyncStorage.setItem('hearby_lang', code);
  }, []);

  // Core state: selected coordinate and temp marker coords
  const [selectedCoordinate, setSelectedCoordinate] =
    useState<Coordinate | null>(null);
  const [tempMarkerCoords, setTempMarkerCoords] = useState<Coordinate | null>(
    null,
  );

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<AutocompleteResult[]>([]);

  // Debounce search input (500ms) to avoid Nominatim 429 rate limits
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load recent searches from storage on mount
  useEffect(() => {
    AsyncStorage.getItem('hearby_recents').then(val => {
      if (val) {
        try { setRecentSearches(JSON.parse(val)); } catch {}
      }
    });
  }, []);

  // TTS playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Feature flag: Premium AI Voice (OpenAI TTS) vs on-device Siri-style
  const [usePremiumVoice, setUsePremiumVoice] = useState(false);

  // Load premium voice preference on mount
  useEffect(() => {
    AsyncStorage.getItem('hearby_premium_voice').then(val => {
      if (val === 'true') setUsePremiumVoice(true);
    });
  }, []);

  const handleTogglePremiumVoice = useCallback((enabled: boolean) => {
    setUsePremiumVoice(enabled);
    AsyncStorage.setItem('hearby_premium_voice', enabled ? 'true' : 'false');
  }, []);

  // Targeted fetch: only when coordinate is selected
  const { data: poiData, isLoading } = useQuery({
    queryKey: [
      'poi',
      selectedCoordinate?.latitude,
      selectedCoordinate?.longitude,
      deviceLanguage,
    ],
    queryFn: () => fetchPoiEnrichment(selectedCoordinate!, deviceLanguage),
    enabled: !!selectedCoordinate,
    staleTime: 7 * 24 * 60 * 60 * 1000, // 1 week
    gcTime: 7 * 24 * 60 * 60 * 1000,
  });

  // Autocomplete search query - uses Nominatim OpenStreetMap API
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ['autocomplete', debouncedQuery, deviceLanguage],
    queryFn: () => fetchAutocomplete(debouncedQuery, deviceLanguage),
    enabled: debouncedQuery.trim().length >= 2 && isSearchFocused,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // TTS initialization and event listeners
  useEffect(() => {
    HearbyTts.setLanguage('he-IL');
    HearbyTts.activateAudioSession();

    const finishSub = ttsEmitter.addListener('tts-finish', () => {
      setIsPlaying(false);
      setIsPaused(false);
    });
    const cancelSub = ttsEmitter.addListener('tts-cancel', () => {
      setIsPlaying(false);
      setIsPaused(false);
    });
    const pauseSub = ttsEmitter.addListener('tts-pause', () => {
      setIsPaused(true);
    });
    const resumeSub = ttsEmitter.addListener('tts-resume', () => {
      setIsPaused(false);
    });
    const errorSub = ttsEmitter.addListener('tts-error', () => {
      setIsPlaying(false);
      setIsPaused(false);
    });

    return () => {
      HearbyTts.stop();
      finishSub.remove();
      cancelSub.remove();
      pauseSub.remove();
      resumeSub.remove();
      errorSub.remove();
    };
  }, []);

  // Handle map press - send coordinates directly to backend
  const handleMapPress = useCallback(
    (coordinate: Coordinate) => {
      console.log('[NearbyPoisScreen] Map pressed at:', coordinate);

      // Show temp marker immediately for visual feedback
      setTempMarkerCoords(coordinate);
      setSelectedCoordinate(coordinate);

      // Stop any current playback
      HearbyTts.stop();
      setIsPlaying(false);
      isPaused && setIsPaused(false);
    },
    [isPaused],
  );

  // Handle search result selection with smart zoom based on type
  const handleSearchResultSelect = useCallback((result: AutocompleteResult) => {
    // Save to recent searches (max 8, no duplicates)
    setRecentSearches(prev => {
      const filtered = prev.filter(r => r.title !== result.title);
      const updated = [result, ...filtered].slice(0, 8);
      AsyncStorage.setItem('hearby_recents', JSON.stringify(updated));
      return updated;
    });
    console.log('[NearbyPoisScreen] Search result selected:', result.title, result.type);

    // Exit search focus mode
    setSearchQuery('');
    setIsSearchFocused(false);
    Keyboard.dismiss();

    // Check if result has coordinates
    if (!result.lat || !result.lng) {
      console.warn('[NearbyPoisScreen] Search result has no coordinates');
      return;
    }

    const coordinate: Coordinate = {
      latitude: result.lat,
      longitude: result.lng,
    };

    // Stop any current playback
    HearbyTts.stop();
    setIsPlaying(false);
    setIsPaused(false);

    if (result.type === 'city') {
      // City: Wide zoom, no marker, no audio sheet
      console.log('[NearbyPoisScreen] Flying to city with wide zoom');
      
      mapRef.current?.animateToRegion(
        {
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          latitudeDelta: 0.12, // Wide view for cities
          longitudeDelta: 0.12,
        },
        1500,
      );

      // Clear any existing marker/selection (don't trigger POI fetch)
      setTempMarkerCoords(null);
      setSelectedCoordinate(null);
    } else {
      // POI: Tight zoom, place marker, trigger audio sheet
      console.log('[NearbyPoisScreen] Flying to POI with tight zoom');
      
      mapRef.current?.animateToRegion(
        {
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          latitudeDelta: 0.008, // Immersive zoom for landmarks
          longitudeDelta: 0.008,
        },
        1500,
      );

      // Set marker and trigger POI enrichment automatically
      setTempMarkerCoords(coordinate);
      setSelectedCoordinate(coordinate);
    }
  }, []);

  // Cancel search - return to map
  const handleCancelSearch = useCallback(() => {
    setSearchQuery('');
    setIsSearchFocused(false);
    Keyboard.dismiss();
  }, []);

  // Close bottom sheet and clear selection
  const handleClose = useCallback(() => {
    setSelectedCoordinate(null);
    setTempMarkerCoords(null);
    HearbyTts.stop();
    setIsPlaying(false);
    setIsPaused(false);
  }, []);

  // Play/pause TTS handler
  const handlePlayPause = useCallback(() => {
    if (!poiData?.masterScript) return;

    if (isPlaying) {
      if (isPaused) {
        HearbyTts.resume();
      } else {
        HearbyTts.pause();
      }
    } else {
      if (usePremiumVoice) {
        // Stream from OpenAI TTS via backend
        const params = new URLSearchParams({
          text: poiData.masterScript,
          lang: deviceLanguage,
        });
        const audioUrl = `${BASE_URL}/pois/audio?${params}`;
        HearbyTts.playAudioFromURL(audioUrl);
      } else {
        // On-device Siri-style TTS
        const hebrewPattern = /[\u0590-\u05FF]/;
        const hasHebrew = hebrewPattern.test(poiData.masterScript);
        const lang = hasHebrew ? 'he-IL' : 'en-US';
        HearbyTts.setLanguage(lang);
        HearbyTts.speak(poiData.masterScript);
      }
      setIsPlaying(true);
      setIsPaused(false);
    }
  }, [poiData, isPlaying, isPaused, usePremiumVoice, deviceLanguage]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Free Exploration Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: 32.0853, // Tel Aviv
          longitude: 34.7818,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        showsUserLocation
        showsPointsOfInterest
        showsCompass
        showsMyLocationButton={false}
        onPress={(e) => handleMapPress(e.nativeEvent.coordinate)}
      >
        {/* Temporary marker at clicked location */}
        {tempMarkerCoords && (
          <Marker
            coordinate={tempMarkerCoords}
            pinColor="#f59e0b"
            title={poiData?.name || 'טוען...'}
          />
        )}
      </MapView>

      {/* Apple Maps-Style Search Panel */}
      <Animated.View
        style={[
          styles.searchPanel,
          { maxHeight: PANEL_MAX_HEIGHT },
        ]}
      >
        {/* Drag Handle */}
        <View style={styles.dragHandle}>
          <View style={styles.dragHandleBar} />
        </View>

        {/* Header Row: Close + Search Input */}
        <View style={styles.searchHeader}>
          <TouchableOpacity
            style={styles.closeSearchBtn}
            onPress={handleCancelSearch}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.closeSearchBtnText}>✕</Text>
          </TouchableOpacity>

          <View style={styles.searchInputWrapper}>
            <TextInput
              style={styles.searchInput}
              placeholder="חיפוש..."
              placeholderTextColor="#8e8e93"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => setIsSearchFocused(true)}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.searchInputIcon}>
              <Text style={styles.searchInputIconText}>🔍</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.langBadge}
            onPress={() => setShowLangPicker(true)}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={styles.langBadgeText}>
              {LANG_FLAGS[deviceLanguage] || '🌐'} {deviceLanguage.toUpperCase()}
            </Text>
          </TouchableOpacity>
        </View>

        {/* State A: Default View (empty query) */}
        {!searchQuery.trim() && (
          <View style={styles.defaultContent}>
            {/* Recent Searches */}
            {recentSearches.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>אחרונים</Text>
                {recentSearches.map((item, idx) => (
                  <TouchableOpacity
                    key={`recent-${idx}`}
                    style={styles.recentRow}
                    activeOpacity={0.6}
                    onPress={() => handleSearchResultSelect(item)}
                  >
                    <View style={styles.recentIcon}>
                      <Text style={styles.recentIconText}>🕐</Text>
                    </View>
                    <Text style={styles.recentLabel} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.categoryChevron}>‹</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Nearby Exploration Section */}
            <Text style={[styles.sectionTitle, recentSearches.length > 0 && { marginTop: 20 }]}>
              חיפוש בסביבה
            </Text>
            <TouchableOpacity
              style={styles.categoryRow}
              activeOpacity={0.6}
              onPress={() => {
                // Trigger POI discovery from current map center
                mapRef.current?.getCamera().then(camera => {
                  if (camera?.center) {
                    handleMapPress(camera.center);
                  }
                });
              }}
            >
              <View style={styles.categoryIcon}>
                <Text style={styles.categoryIconText}>⭐</Text>
              </View>
              <Text style={styles.categoryLabel}>אתרים וציוני דרך</Text>
              <Text style={styles.categoryChevron}>‹</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* State B: Results View (typing/results exist) */}
        {searchQuery.trim().length >= 2 && (
          <View style={styles.resultsContent}>
            {isSearching ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="small" color="#007aff" />
              </View>
            ) : searchResults.length > 0 ? (
              <FlatList
                data={searchResults}
                keyExtractor={(item, index) => `${item.title}-${index}`}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                renderItem={({ item, index }) => {
                  const isTopMatch = index === 0 && item.type === 'city';
                  return (
                    <TouchableOpacity
                      style={[
                        styles.resultCard,
                        isTopMatch && styles.resultCardTop,
                      ]}
                      onPress={() => handleSearchResultSelect(item)}
                      activeOpacity={0.6}
                    >
                      <View style={styles.resultRow}>
                        <View style={[
                          styles.resultIconCircle,
                          isTopMatch ? styles.resultIconGlobe : styles.resultIconStar,
                        ]}>
                          <Text style={styles.resultIconText}>
                            {item.type === 'city' ? '🌍' : '⭐'}
                          </Text>
                        </View>
                        <View style={styles.resultTextBlock}>
                          <Text style={styles.resultTitle} numberOfLines={1}>
                            {item.title}
                          </Text>
                          {item.description ? (
                            <Text style={styles.resultSubtitle} numberOfLines={1}>
                              {item.description}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      {isTopMatch && (
                        <View style={styles.guidesBtn}>
                          <Text style={styles.guidesBtnText}>מדריכים</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }}
                ItemSeparatorComponent={() => <View style={styles.resultDivider} />}
              />
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>לא נמצאו תוצאות</Text>
              </View>
            )}
          </View>
        )}
      </Animated.View>

      {/* Conditional Bottom Sheet */}
      {selectedCoordinate && (
        <View
          style={[styles.bottomSheet, { paddingBottom: insets.bottom + 16 }]}
        >
          {/* Close button */}
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={handleClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>

          {/* POI Title */}
          <Text style={styles.title} numberOfLines={2}>
            {isLoading
              ? 'מחפש מקום מעניין...'
              : poiData?.name || 'מקום לא מוכר'}
          </Text>

          {/* Loading State - Wikipedia fetch */}
          {isLoading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#6366f1" />
              <Text style={styles.loadingText}>טוען מידע...</Text>
            </View>
          )}

          {/* Condition A: Audio content available */}
          {!isLoading && poiData?.masterScript && (
            <View style={styles.audioContainer}>
              <TouchableOpacity
                style={[
                  styles.playBtn,
                  isPlaying && !isPaused && styles.playBtnActive,
                ]}
                onPress={handlePlayPause}
                activeOpacity={0.8}
              >
                <Text style={styles.playBtnIcon}>
                  {isPlaying && !isPaused ? '⏸️' : '▶️'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.audioLabel}>
                {isPlaying && !isPaused ? 'מושמע כעת...' : 'הקש להשמעת תוכן'}
              </Text>
            </View>
          )}

          {/* Condition B: No audio content */}
          {!isLoading && !poiData?.masterScript && (
            <View style={styles.noAudioContainer}>
              <Text style={styles.mutedIcon}>🔇</Text>
              <Text style={styles.noAudioText}>אין תוכן שמע זמין למקום זה</Text>
            </View>
          )}
        </View>
      )}
      {/* Language Picker Modal */}
      <Modal
        visible={showLangPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLangPicker(false)}
      >
        <TouchableOpacity
          style={styles.langModalOverlay}
          activeOpacity={1}
          onPress={() => setShowLangPicker(false)}
        >
          <View style={styles.langModalContent}>
            <Text style={styles.langModalTitle}>Select Language</Text>
            {preferredLanguages.map(lang => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.langOption,
                  lang.code === deviceLanguage && styles.langOptionSelected,
                ]}
                onPress={() => handleLanguageChange(lang.code)}
              >
                <Text style={[
                  styles.langOptionText,
                  lang.code === deviceLanguage && styles.langOptionTextSelected,
                ]}>
                  {lang.label}
                </Text>
              </TouchableOpacity>
            ))}

            {/* Premium AI Voice Toggle */}
            <View style={styles.premiumVoiceDivider} />
            <TouchableOpacity
              style={styles.premiumVoiceRow}
              onPress={() => handleTogglePremiumVoice(!usePremiumVoice)}
            >
              <Text style={styles.premiumVoiceLabel}>
                🎙️ Premium AI Voice
              </Text>
              <View style={[
                styles.premiumVoiceToggle,
                usePremiumVoice && styles.premiumVoiceToggleOn,
              ]}>
                <View style={[
                  styles.premiumVoiceThumb,
                  usePremiumVoice && styles.premiumVoiceThumbOn,
                ]} />
              </View>
            </TouchableOpacity>
            <Text style={styles.premiumVoiceHint}>
              {usePremiumVoice ? 'OpenAI TTS (costs apply)' : 'On-device Siri voice (free)'}
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },
  map: {
    flex: 1,
  },

  // Apple Maps Search Panel (Bottom Card)
  searchPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 16,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 24,
  },
  dragHandle: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 14,
  },
  dragHandleBar: {
    width: 40,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#D1D1D6',
  },

  // Header Row
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  closeSearchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E5E5EA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeSearchBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#3C3C43',
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    backgroundColor: '#E5E5EA',
    borderRadius: 22,
    paddingHorizontal: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    color: '#000',
    textAlign: 'right',
    paddingVertical: 0,
  },
  searchInputIcon: {
    marginLeft: 8,
  },
  searchInputIconText: {
    fontSize: 16,
    opacity: 0.5,
  },
  langBadge: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#E5E5EA',
    borderRadius: 16,
  },
  langBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3C3C43',
  },

  // State A: Default Content
  defaultContent: {
    paddingTop: 4,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    textAlign: 'right',
    marginBottom: 14,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  recentIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E5E5EA',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  recentIconText: {
    fontSize: 14,
  },
  recentLabel: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    textAlign: 'right',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  categoryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  categoryIconText: {
    fontSize: 18,
  },
  categoryLabel: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
    textAlign: 'right',
  },
  categoryChevron: {
    fontSize: 22,
    color: '#C7C7CC',
    fontWeight: '300',
  },

  // State B: Results Content
  resultsContent: {
    flex: 1,
  },
  loadingState: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 17,
    color: '#8e8e93',
  },
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 0,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  resultCardTop: {
    marginBottom: 12,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  resultIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  resultIconGlobe: {
    backgroundColor: '#34C759',
  },
  resultIconStar: {
    backgroundColor: '#007AFF',
  },
  resultIconText: {
    fontSize: 18,
  },
  resultTextBlock: {
    flex: 1,
    alignItems: 'flex-end',
  },
  resultTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
    textAlign: 'right',
  },
  resultSubtitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 2,
    textAlign: 'right',
  },
  guidesBtn: {
    marginTop: 12,
    backgroundColor: '#E8F0FE',
    borderRadius: 20,
    paddingVertical: 10,
    alignItems: 'center',
  },
  guidesBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#007AFF',
  },
  resultDivider: {
    height: 0,
  },

  // Bottom Sheet Styles (POI Audio Player)
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingTop: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 16,
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  closeBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#64748b',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 16,
    paddingRight: 40,
    textAlign: 'right',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748b',
  },
  audioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 8,
  },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  playBtnActive: {
    backgroundColor: '#4338ca',
  },
  playBtnIcon: {
    fontSize: 24,
  },
  audioLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'right',
  },
  noAudioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 20,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
  },
  mutedIcon: {
    fontSize: 28,
  },
  noAudioText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },

  // Language Picker Modal
  langModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  langModalContent: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    width: 220,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  langModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  langOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  langOptionSelected: {
    backgroundColor: '#007AFF15',
  },
  langOptionText: {
    fontSize: 16,
    color: '#333',
  },
  langOptionTextSelected: {
    color: '#007AFF',
    fontWeight: '600',
  },
  premiumVoiceDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 12,
  },
  premiumVoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  premiumVoiceLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  premiumVoiceToggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#cbd5e1',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  premiumVoiceToggleOn: {
    backgroundColor: '#007AFF',
  },
  premiumVoiceThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  premiumVoiceThumbOn: {
    alignSelf: 'flex-end',
  },
  premiumVoiceHint: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 6,
    paddingHorizontal: 4,
  },
});
