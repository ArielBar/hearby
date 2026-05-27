import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  NativeEventEmitter,
  NativeModules,
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

interface EnrichResult {
  name: string;
  category: string;
  summary: string;
  url: string;
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
 * Fetch autocomplete suggestions from Wikipedia
 */
async function fetchAutocomplete(query: string): Promise<AutocompleteResult[]> {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const params = new URLSearchParams({ query: query.trim() });
  const res = await fetch(`${BASE_URL}/wikipedia/autocomplete?${params}`);

  if (!res.ok) {
    return [];
  }

  return res.json();
}

export function NearbyPoisScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  // Core state: selected coordinate and temp marker coords
  const [selectedCoordinate, setSelectedCoordinate] =
    useState<Coordinate | null>(null);
  const [tempMarkerCoords, setTempMarkerCoords] = useState<Coordinate | null>(
    null,
  );

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);

  // TTS playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

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

  // Autocomplete search query - debounced
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ['autocomplete', searchQuery],
    queryFn: () => fetchAutocomplete(searchQuery),
    enabled: searchQuery.trim().length >= 2 && showSearchResults,
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

  // Handle search result selection
  const handleSearchResultSelect = useCallback((result: AutocompleteResult) => {
    console.log('[NearbyPoisScreen] Search result selected:', result.title);

    // Clear search UI
    setSearchQuery('');
    setShowSearchResults(false);
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

    // Animate map camera to destination (fly-to effect)
    mapRef.current?.animateToRegion(
      {
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        latitudeDelta: 0.01, // Zoomed in for landmark view
        longitudeDelta: 0.01,
      },
      1500, // 1.5 second animation
    );

    // Set marker and trigger POI enrichment automatically
    setTempMarkerCoords(coordinate);
    setSelectedCoordinate(coordinate);

    // Stop any current playback
    HearbyTts.stop();
    setIsPlaying(false);
    setIsPaused(false);
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
    if (!poiData?.summary) return;

    if (isPlaying) {
      if (isPaused) {
        HearbyTts.resume();
      } else {
        HearbyTts.pause();
      }
    } else {
      // Start new playback with language detection
      const hebrewPattern = /[\u0590-\u05FF]/;
      const hasHebrew = hebrewPattern.test(poiData.summary);
      const lang = hasHebrew ? 'he-IL' : 'en-US';

      try {
        HearbyTts.setLanguage(lang);
        HearbyTts.speak(poiData.summary);
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

      {/* Global Search Bar - Floating at Top */}
      <View style={[styles.searchContainer, { top: insets.top + 12 }]}>
        <View style={styles.searchInputWrapper}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="חפש יעד תיירותי בעולם..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => setShowSearchResults(true)}
            onBlur={() => {
              // Delay to allow result selection
              setTimeout(() => setShowSearchResults(false), 200);
            }}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setSearchQuery('');
                setShowSearchResults(false);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.clearIcon}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Search Results Dropdown */}
        {showSearchResults && searchQuery.trim().length >= 2 && (
          <View style={styles.searchResultsContainer}>
            {isSearching ? (
              <View style={styles.searchLoadingContainer}>
                <ActivityIndicator size="small" color="#6366f1" />
                <Text style={styles.searchLoadingText}>מחפש...</Text>
              </View>
            ) : searchResults.length > 0 ? (
              <FlatList
                data={searchResults}
                keyExtractor={(item, index) => `${item.title}-${index}`}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.searchResultItem}
                    onPress={() => handleSearchResultSelect(item)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.searchResultContent}>
                      <Text style={styles.searchResultTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      {item.description && (
                        <Text style={styles.searchResultDesc} numberOfLines={2}>
                          {item.description.replace(/<[^>]*>/g, '')}
                        </Text>
                      )}
                      {!item.lat || !item.lng ? (
                        <Text style={styles.noLocationBadge}>אין מיקום</Text>
                      ) : null}
                    </View>
                    <Text style={styles.searchResultArrow}>←</Text>
                  </TouchableOpacity>
                )}
                style={styles.searchResultsList}
              />
            ) : (
              <View style={styles.searchEmptyContainer}>
                <Text style={styles.searchEmptyText}>לא נמצאו תוצאות</Text>
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
          {!isLoading && poiData?.summary && (
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
          {!isLoading && !poiData?.summary && (
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
    backgroundColor: '#f8fafc',
  },
  map: {
    flex: 1,
  },
  // Search Bar Styles
  searchContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 10,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  searchIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1e293b',
    textAlign: 'right',
    padding: 0,
  },
  clearIcon: {
    fontSize: 16,
    color: '#94a3b8',
    fontWeight: '700',
    marginLeft: 8,
  },
  searchResultsContainer: {
    marginTop: 8,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    maxHeight: 320,
    overflow: 'hidden',
  },
  searchResultsList: {
    maxHeight: 320,
  },
  searchLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  searchLoadingText: {
    fontSize: 14,
    color: '#64748b',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  searchResultContent: {
    flex: 1,
    marginRight: 12,
  },
  searchResultTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
    textAlign: 'right',
  },
  searchResultDesc: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    textAlign: 'right',
  },
  noLocationBadge: {
    fontSize: 11,
    color: '#ef4444',
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'right',
  },
  searchResultArrow: {
    fontSize: 18,
    color: '#cbd5e1',
  },
  searchEmptyContainer: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  searchEmptyText: {
    fontSize: 14,
    color: '#94a3b8',
    fontWeight: '500',
  },
  // Bottom Sheet Styles
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
