import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  NativeEventEmitter,
  NativeModules,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { HearbyTts } = NativeModules;
const ttsEmitter = new NativeEventEmitter(HearbyTts);

// Backend API call
const BASE_URL = 'http://localhost:3000/api';

/**
 * Detect device language (2-letter code)
 * Returns 'he', 'en', 'es', etc. Defaults to 'en'.
 */
function getDeviceLanguage(): string {
  try {
    // iOS: Use NativeModules.SettingsManager
    if (Platform.OS === 'ios') {
      const locale =
        NativeModules.SettingsManager?.settings?.AppleLocale ||
        NativeModules.SettingsManager?.settings?.AppleLanguages?.[0];
      if (locale) {
        return locale.split('_')[0].split('-')[0].toLowerCase();
      }
    }

    // Android: Use I18nManager
    if (Platform.OS === 'android') {
      const locale = NativeModules.I18nManager?.localeIdentifier;
      if (locale) {
        return locale.split('_')[0].split('-')[0].toLowerCase();
      }
    }
  } catch (error) {
    console.warn('[Language Detection] Failed to detect device language:', error);
  }

  // Fallback to English
  return 'en';
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
): Promise<EnrichResult | null> {
  const params = new URLSearchParams({
    lat: coordinate.latitude.toString(),
    lng: coordinate.longitude.toString(),
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
      `${BASE_URL}/wikipedia/nominatim-search?${params}`
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
  const [deviceLanguage] = useState(() => getDeviceLanguage());

  // Core state: selected coordinate and temp marker coords
  const [selectedCoordinate, setSelectedCoordinate] =
    useState<Coordinate | null>(null);
  const [tempMarkerCoords, setTempMarkerCoords] = useState<Coordinate | null>(
    null,
  );

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // TTS playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Log detected language on mount
  useEffect(() => {
    console.log('[NearbyPoisScreen] Device language for search:', deviceLanguage);
  }, [deviceLanguage]);

  // Targeted fetch: only when coordinate is selected
  const { data: poiData, isLoading } = useQuery({
    queryKey: [
      'poi',
      selectedCoordinate?.latitude,
      selectedCoordinate?.longitude,
    ],
    queryFn: () => fetchPoiEnrichment(selectedCoordinate!),
    enabled: !!selectedCoordinate,
    staleTime: 7 * 24 * 60 * 60 * 1000, // 1 week
    gcTime: 7 * 24 * 60 * 60 * 1000,
  });

  // Autocomplete search query - uses Nominatim OpenStreetMap API
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ['autocomplete', searchQuery, deviceLanguage],
    queryFn: () => fetchAutocomplete(searchQuery, deviceLanguage),
    enabled: searchQuery.trim().length >= 2 && isSearchFocused,
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
      // Start new playback with language detection
      // Master script is always in English (from OpenAI)
      const hebrewPattern = /[\u0590-\u05FF]/;
      const hasHebrew = hebrewPattern.test(poiData.masterScript);
      const lang = hasHebrew ? 'he-IL' : 'en-US';

      try {
        HearbyTts.setLanguage(lang);
        HearbyTts.speak(poiData.masterScript);
        setIsPlaying(true);
        setIsPaused(false);
      } catch (err) {
        console.error('[TTS] Playback error:', err);
      }
    }
  }, [poiData, isPlaying, isPaused]);

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

      {/* Apple Maps-Style Global Search */}
      <View
        style={[
          styles.searchOverlay,
          isSearchFocused && styles.searchOverlayFocused,
          { paddingTop: insets.top + 8 },
        ]}
      >
        <View style={styles.searchBar}>
          <View style={styles.searchIconContainer}>
            <Text style={styles.searchIcon}>🔍</Text>
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="חפש או חקור מקומות"
            placeholderTextColor="#8e8e93"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => setIsSearchFocused(true)}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {isSearchFocused && (
            <TouchableOpacity
              onPress={handleCancelSearch}
              style={styles.cancelButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.cancelText}>ביטול</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Apple Maps-Style Results */}
        {isSearchFocused && searchQuery.trim().length >= 2 && (
          <View style={styles.resultsContainer}>
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
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.resultRow}
                    onPress={() => handleSearchResultSelect(item)}
                    activeOpacity={0.6}
                  >
                    {/* Icon based on type */}
                    <View style={styles.resultIconContainer}>
                      <Text style={styles.resultIcon}>
                        {item.type === 'city' ? '🌐' : '📍'}
                      </Text>
                    </View>

                    {/* Text Content */}
                    <View style={styles.resultTextContainer}>
                      <Text style={styles.resultTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      {item.description && (
                        <Text style={styles.resultSubtitle} numberOfLines={2}>
                          {item.description}
                        </Text>
                      )}
                      {(!item.lat || !item.lng) && (
                        <Text style={styles.noLocationLabel}>אין מיקום זמין</Text>
                      )}
                    </View>

                    {/* Chevron Arrow */}
                    <View style={styles.resultChevron}>
                      <Text style={styles.chevronIcon}>›</Text>
                    </View>
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.resultDivider} />}
              />
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>לא נמצאו תוצאות</Text>
              </View>
            )}
          </View>
        )}
      </View>

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
  
  // Apple Maps-Style Search Overlay
  searchOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 16,
  },
  searchOverlayFocused: {
    backgroundColor: '#f2f2f7',
    height: '100%',
    zIndex: 999,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchIconContainer: {
    position: 'absolute',
    left: 12,
    zIndex: 1,
  },
  searchIcon: {
    fontSize: 18,
    opacity: 0.5,
  },
  searchInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingHorizontal: 40,
    fontSize: 17,
    color: '#000000',
    textAlign: 'right',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cancelButton: {
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 17,
    color: '#007aff',
    fontWeight: '400',
  },

  // Results Container
  resultsContainer: {
    marginTop: 12,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    maxHeight: '80%',
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

  // Result Row (Apple Maps Style)
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
  },
  resultIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#f2f2f7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  resultIcon: {
    fontSize: 20,
  },
  resultTextContainer: {
    flex: 1,
    marginRight: 8,
  },
  resultTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 2,
    textAlign: 'right',
  },
  resultSubtitle: {
    fontSize: 15,
    color: '#8e8e93',
    lineHeight: 20,
    textAlign: 'right',
  },
  noLocationLabel: {
    fontSize: 13,
    color: '#ff3b30',
    marginTop: 4,
    textAlign: 'right',
  },
  resultChevron: {
    marginLeft: 8,
  },
  chevronIcon: {
    fontSize: 24,
    color: '#c7c7cc',
    fontWeight: '300',
  },
  resultDivider: {
    height: 0.5,
    backgroundColor: '#c6c6c8',
    marginLeft: 64, // Align with text, not icon
  },

  // Bottom Sheet Styles (existing)
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
    paddingRight: 40, // Space for close button
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
});
