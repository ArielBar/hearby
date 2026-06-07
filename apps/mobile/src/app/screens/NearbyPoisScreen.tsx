import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  I18nManager,
  Image,
  Keyboard,
  Modal,
  NativeEventEmitter,
  NativeModules,
  SafeAreaView,
  ScrollView,
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
import Geolocation from 'react-native-geolocation-service';
const { HearbyTts } = NativeModules;
const ttsEmitter = new NativeEventEmitter(HearbyTts);
const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PANEL_MAX_HEIGHT = SCREEN_HEIGHT * 0.55;

// Brand icons
const ICONS = {
  search: require('../../../assets/icons/search.png'),
  close: require('../../../assets/icons/close.png'),
  recent: require('../../../assets/icons/recent.png'),
  landmark: require('../../../assets/icons/landmark.png'),
  globe: require('../../../assets/icons/globe.png'),
  chevronLeft: require('../../../assets/icons/chevron-left.png'),
  chevronRight: require('../../../assets/icons/chevron-right.png'),
  play: require('../../../assets/icons/play.png'),
  pause: require('../../../assets/icons/pause.png'),
  muted: require('../../../assets/icons/muted.png'),
  mic: require('../../../assets/icons/mic.png'),
};

// Backend API call
const BASE_URL = 'http://localhost:3000/api';

// Localized UI strings
const UI_STRINGS: Record<string, Record<string, string>> = {
  he: {
    searchPlaceholder: 'חיפוש...',
    recents: 'אחרונים',
    nearbyExploration: 'חיפוש בסביבה',
    landmarks: 'אתרים וציוני דרך בקרבת מקום',
    noResults: 'לא נמצאו תוצאות',
    guides: 'מדריכים',
    loading: 'טוען מידע...',
    searchingPoi: 'מחפש מקום מעניין...',
    unknownPlace: 'מקום לא מוכר',
    playAudio: 'הקש להשמעת תוכן',
    nowPlaying: 'מושמע כעת...',
    noAudio: 'אין תוכן שמע זמין למקום זה',
    explorePoi: 'גלה מקום זה',
    noPlacesFound: 'לא נמצאו מקומות',
  },
  en: {
    searchPlaceholder: 'Search...',
    recents: 'Recents',
    nearbyExploration: 'Explore Nearby',
    landmarks: 'Nearby Landmarks & Attractions',
    noResults: 'No results found',
    guides: 'Guides',
    loading: 'Loading...',
    searchingPoi: 'Looking for a place...',
    unknownPlace: 'Unknown place',
    playAudio: 'Tap to play audio',
    nowPlaying: 'Now playing...',
    noAudio: 'No audio content available',
    explorePoi: 'Explore this spot',
    noPlacesFound: 'No places found nearby',
  },
  es: {
    searchPlaceholder: 'Buscar...',
    recents: 'Recientes',
    nearbyExploration: 'Explorar Cerca',
    landmarks: 'Monumentos y Atracciones Cercanos',
    noResults: 'Sin resultados',
    guides: 'Guías',
    loading: 'Cargando...',
    searchingPoi: 'Buscando un lugar...',
    unknownPlace: 'Lugar desconocido',
    playAudio: 'Toca para reproducir',
    nowPlaying: 'Reproduciendo...',
    noAudio: 'No hay audio disponible',
    explorePoi: 'Explorar este lugar',
    noPlacesFound: 'No se encontraron lugares',
  },
  it: {
    searchPlaceholder: 'Cerca...',
    recents: 'Recenti',
    nearbyExploration: 'Esplora Dintorni',
    landmarks: 'Monumenti e Attrazioni Vicini',
    noResults: 'Nessun risultato',
    guides: 'Guide',
    loading: 'Caricamento...',
    searchingPoi: 'Cercando un luogo...',
    unknownPlace: 'Luogo sconosciuto',
    playAudio: 'Tocca per ascoltare',
    nowPlaying: 'In riproduzione...',
    noAudio: 'Nessun audio disponibile',
    explorePoi: 'Esplora questo luogo',
    noPlacesFound: 'Nessun luogo trovato',
  },
  fr: {
    searchPlaceholder: 'Rechercher...',
    recents: 'Récents',
    nearbyExploration: 'Explorer les Environs',
    landmarks: 'Sites et Monuments à Proximité',
    noResults: 'Aucun résultat',
    guides: 'Guides',
    loading: 'Chargement...',
    searchingPoi: 'Recherche en cours...',
    unknownPlace: 'Lieu inconnu',
    playAudio: 'Appuyez pour écouter',
    nowPlaying: 'Lecture en cours...',
    noAudio: 'Aucun audio disponible',
    explorePoi: 'Explorer ce lieu',
    noPlacesFound: 'Aucun lieu trouvé',
  },
};

function t(lang: string, key: string): string {
  return UI_STRINGS[lang]?.[key] || UI_STRINGS['en'][key] || key;
}

const RTL_LANGUAGES = new Set(['he', 'ar', 'fa', 'ur']);

function isRTL(lang: string): boolean {
  return RTL_LANGUAGES.has(lang);
}

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

interface NearbyPoi {
  title: string;
  description: string;
  lat: number;
  lng: number;
}

/**
 * Fetch nearby tourist POIs within radius
 */
async function fetchNearbyPois(
  lat: number,
  lng: number,
  language: string,
  radius: number = 100,
): Promise<NearbyPoi[]> {
  try {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lng: lng.toString(),
      lang: language,
      radius: radius.toString(),
    });
    const res = await fetch(`${BASE_URL}/search/nearby?${params}`);
    if (!res.ok) return [];
    const results = await res.json();
    return Array.isArray(results) ? results : [];
  } catch (error) {
    console.error('[NearbyPois] Failed to fetch:', error);
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

  // Panel collapse state
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  // Nearby POIs state
  const [nearbyPois, setNearbyPois] = useState<NearbyPoi[]>([]);
  const [isLoadingNearby, setIsLoadingNearby] = useState(false);
  const [nearbySearchDone, setNearbySearchDone] = useState(false);

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

  // Direction-aware layout based on selected language
  const rtl = useMemo(() => isRTL(deviceLanguage), [deviceLanguage]);
  const dirStyles = useMemo(() => ({
    row: { flexDirection: rtl ? 'row' : 'row-reverse' } as const,
    textAlign: { textAlign: rtl ? 'right' : 'left' } as const,
    writingDirection: { writingDirection: rtl ? 'rtl' : 'ltr' } as const,
  }), [rtl]);

  // Targeted fetch: only when coordinate is confirmed by user
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

  // Show POI player modal when data is fetched
  const [showPoiModal, setShowPoiModal] = useState(false);

  useEffect(() => {
    if (selectedCoordinate && (isLoading || poiData)) {
      setShowPoiModal(true);
    }
  }, [selectedCoordinate, isLoading, poiData]);

  // Save to recents when POI enrichment returns a name
  useEffect(() => {
    if (poiData?.name && selectedCoordinate) {
      const entry: AutocompleteResult = {
        title: poiData.name,
        description: '',
        lat: selectedCoordinate.latitude,
        lng: selectedCoordinate.longitude,
        type: 'poi',
      };
      setRecentSearches(prev => {
        const filtered = prev.filter(r => r.title !== entry.title);
        const updated = [entry, ...filtered].slice(0, 8);
        AsyncStorage.setItem('hearby_recents', JSON.stringify(updated));
        return updated;
      });
    }
  }, [poiData?.name, selectedCoordinate]);

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

  // Handle map press - place marker only, don't call server yet
  const handleMapPress = useCallback(
    (coordinate: Coordinate) => {
      console.log('[NearbyPoisScreen] Map pressed at:', coordinate);

      // Only place marker for visual feedback
      setTempMarkerCoords(coordinate);

      // Clear any previous selection (stop API/playback)
      if (selectedCoordinate) {
        setSelectedCoordinate(null);
        setShowPoiModal(false);
        HearbyTts.stop();
        setIsPlaying(false);
        setIsPaused(false);
      }
    },
    [selectedCoordinate],
  );

  // User confirms interest in the POI - triggers API call
  const handleConfirmPoi = useCallback(() => {
    if (!tempMarkerCoords) return;
    console.log('[NearbyPoisScreen] User confirmed POI exploration');
    setSelectedCoordinate(tempMarkerCoords);
  }, [tempMarkerCoords]);

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
      // POI: Tight zoom, place marker, show confirm button
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

      // Set marker only — user must confirm to trigger enrichment
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

  // Close POI modal and clear selection
  const handleClose = useCallback(() => {
    setSelectedCoordinate(null);
    setTempMarkerCoords(null);
    setShowPoiModal(false);
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
          { maxHeight: isPanelCollapsed ? 36 : PANEL_MAX_HEIGHT },
        ]}
      >
        {/* Drag Handle — tap to collapse/expand */}
        <TouchableOpacity
          style={styles.dragHandle}
          activeOpacity={0.7}
          onPress={() => setIsPanelCollapsed(prev => !prev)}
        >
          <View style={styles.dragHandleBar} />
        </TouchableOpacity>

        {!isPanelCollapsed && (<>
        {/* Header Row: Close + Search Input */}
        <View style={[styles.searchHeader, dirStyles.row]}>
          <TouchableOpacity
            style={styles.closeSearchBtn}
            onPress={handleCancelSearch}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Image source={ICONS.close} style={styles.iconSmall} />
          </TouchableOpacity>

          <View style={styles.searchInputWrapper}>
            <TextInput
              style={[styles.searchInput, dirStyles.textAlign, dirStyles.writingDirection]}
              placeholder={t(deviceLanguage, 'searchPlaceholder')}
              placeholderTextColor="#9994A8"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => setIsSearchFocused(true)}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.searchInputIcon}>
              <Image source={ICONS.search} style={styles.iconSmall} />
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

        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

        {/* State A: Default View (empty query) */}
        {!searchQuery.trim() && (
          <View style={styles.defaultContent}>
            {/* Recent Searches */}
            {recentSearches.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, dirStyles.textAlign]}>{t(deviceLanguage, 'recents')}</Text>
                {recentSearches.map((item, idx) => (
                  <TouchableOpacity
                    key={`recent-${idx}`}
                    style={[styles.recentRow, dirStyles.row]}
                    activeOpacity={0.6}
                    onPress={() => handleSearchResultSelect(item)}
                  >
                    <View style={styles.recentIcon}>
                      <Image source={ICONS.recent} style={styles.iconTiny} />
                    </View>
                    <Text style={[styles.recentLabel, dirStyles.textAlign]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Image source={rtl ? ICONS.chevronLeft : ICONS.chevronRight} style={styles.iconChevron} />
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Nearby Exploration Section */}
            <Text style={[styles.sectionTitle, dirStyles.textAlign, recentSearches.length > 0 && { marginTop: 20 }]}>
              {t(deviceLanguage, 'nearbyExploration')}
            </Text>
            <TouchableOpacity
              style={[styles.categoryRow, dirStyles.row]}
              activeOpacity={0.6}
              onPress={() => {
                setIsLoadingNearby(true);
                setNearbySearchDone(false);
                setNearbyPois([]);
                Geolocation.getCurrentPosition(
                  (position) => {
                    fetchNearbyPois(
                      position.coords.latitude,
                      position.coords.longitude,
                      deviceLanguage,
                    ).then((results) => {
                      setNearbyPois(results);
                      setIsLoadingNearby(false);
                      setNearbySearchDone(true);
                    });
                  },
                  (error) => {
                    console.warn('[NearbyPoisScreen] GPS error, falling back to map center:', error.message);
                    mapRef.current?.getCamera().then(camera => {
                      if (camera?.center) {
                        fetchNearbyPois(
                          camera.center.latitude,
                          camera.center.longitude,
                          deviceLanguage,
                        ).then((results) => {
                          setNearbyPois(results);
                          setIsLoadingNearby(false);
                          setNearbySearchDone(true);
                        });
                      } else {
                        setIsLoadingNearby(false);
                        setNearbySearchDone(true);
                      }
                    });
                  },
                  { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 },
                );
              }}
            >
              <View style={styles.categoryIcon}>
                <Image source={ICONS.landmark} style={styles.iconMedium} />
              </View>
              <Text style={[styles.categoryLabel, dirStyles.textAlign]}>{t(deviceLanguage, 'landmarks')}</Text>
              <Image source={rtl ? ICONS.chevronLeft : ICONS.chevronRight} style={styles.iconChevron} />
            </TouchableOpacity>

            {/* Nearby POIs results */}
            {isLoadingNearby && (
              <View style={styles.loadingState}>
                <ActivityIndicator size="small" color="#40C4C1" />
              </View>
            )}
            {nearbySearchDone && !isLoadingNearby && nearbyPois.length === 0 && (
              <Text style={[styles.noResultsText, dirStyles.textAlign]}>
                {t(deviceLanguage, 'noPlacesFound')}
              </Text>
            )}
            {nearbyPois.length > 0 && (
              <View>
                {nearbyPois.map((item, index) => (
                  <TouchableOpacity
                    key={`nearby-${item.title}-${index}`}
                    style={styles.resultCard}
                    activeOpacity={0.6}
                    onPress={() => {
                      const coord: Coordinate = { latitude: item.lat, longitude: item.lng };
                      setTempMarkerCoords(coord);
                      setSelectedCoordinate(coord);
                      setNearbyPois([]);
                      setNearbySearchDone(false);
                    }}
                  >
                    <View style={styles.categoryIcon}>
                      <Image source={ICONS.landmark} style={styles.iconMedium} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.resultTitle, dirStyles.textAlign]}>{item.title}</Text>
                      {item.description ? (
                        <Text style={[styles.resultSubtitle, dirStyles.textAlign]} numberOfLines={1}>
                          {item.description}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* State B: Results View (typing/results exist) */}
        {searchQuery.trim().length >= 2 && (
          <View style={styles.resultsContent}>
            {isSearching ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="small" color="#40C4C1" />
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
                      <View style={[styles.resultRow, dirStyles.row]}>
                        <View style={[
                          styles.resultIconCircle,
                          isTopMatch ? styles.resultIconGlobe : styles.resultIconStar,
                        ]}>
                          <Image source={item.type === 'city' ? ICONS.globe : ICONS.landmark} style={styles.iconMedium} />
                        </View>
                        <View style={styles.resultTextBlock}>
                          <Text style={[styles.resultTitle, dirStyles.textAlign]} numberOfLines={1}>
                            {item.title}
                          </Text>
                          {item.description ? (
                            <Text style={[styles.resultSubtitle, dirStyles.textAlign]} numberOfLines={1}>
                              {item.description}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      {isTopMatch && (
                        <View style={styles.guidesBtn}>
                          <Text style={styles.guidesBtnText}>{t(deviceLanguage, 'guides')}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }}
                ItemSeparatorComponent={() => <View style={styles.resultDivider} />}
              />
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>{t(deviceLanguage, 'noResults')}</Text>
              </View>
            )}
          </View>
        )}
        </ScrollView>
        </>)}
      </Animated.View>

      {/* Confirm POI Button - shown when marker placed but not yet confirmed */}
      {tempMarkerCoords && !selectedCoordinate && (
        <TouchableOpacity
          style={styles.confirmPoiBtn}
          onPress={handleConfirmPoi}
          activeOpacity={0.8}
        >
          <Image source={ICONS.landmark} style={styles.iconSmall} />
          <Text style={styles.confirmPoiText}>{t(deviceLanguage, 'explorePoi')}</Text>
        </TouchableOpacity>
      )}

      {/* POI Player Modal - slides up over everything */}
      <Modal
        visible={showPoiModal}
        transparent
        animationType="slide"
        onRequestClose={handleClose}
      >
        <View style={styles.poiModalOverlay}>
          <View style={[styles.poiModalContent, { paddingBottom: insets.bottom + 20 }]}>
            {/* Close button */}
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={handleClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Image source={ICONS.close} style={styles.iconSmall} />
            </TouchableOpacity>

            {/* POI Title */}
            <Text style={[styles.title, dirStyles.textAlign]} numberOfLines={2}>
              {isLoading
                ? t(deviceLanguage, 'searchingPoi')
                : poiData?.name || t(deviceLanguage, 'unknownPlace')}
            </Text>

            {/* Loading State */}
            {isLoading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#40C4C1" />
                <Text style={styles.loadingText}>{t(deviceLanguage, 'loading')}</Text>
              </View>
            )}

            {/* Audio content available */}
            {!isLoading && !!poiData?.masterScript && (
              <View style={[styles.audioContainer, dirStyles.row]}>
                <TouchableOpacity
                  style={[
                    styles.playBtn,
                    isPlaying && !isPaused && styles.playBtnActive,
                  ]}
                  onPress={handlePlayPause}
                  activeOpacity={0.8}
                >
                  <Image source={isPlaying && !isPaused ? ICONS.pause : ICONS.play} style={styles.iconPlay} />
                </TouchableOpacity>
                <Text style={[styles.audioLabel, dirStyles.textAlign]}>
                  {isPlaying && !isPaused ? t(deviceLanguage, 'nowPlaying') : t(deviceLanguage, 'playAudio')}
                </Text>
              </View>
            )}

            {/* No audio content */}
            {!isLoading && !poiData?.masterScript && !isLoading && (
              <View style={styles.noAudioContainer}>
                <Image source={ICONS.muted} style={styles.iconLarge} />
                <Text style={styles.noAudioText}>{t(deviceLanguage, 'noAudio')}</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
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
              <View style={styles.premiumVoiceLabelRow}>
                <Image source={ICONS.mic} style={styles.iconTiny} />
                <Text style={styles.premiumVoiceLabel}>Premium AI Voice</Text>
              </View>
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
    backgroundColor: 'rgba(245, 247, 250, 0.94)',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 16,
    paddingBottom: 24,
    shadowColor: '#1E1950',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 24,
    overflow: 'hidden',
  },

  // Brand icon sizes
  iconTiny: {
    width: 20,
    height: 20,
    resizeMode: 'contain',
  },
  iconSmall: {
    width: 24,
    height: 24,
    resizeMode: 'contain',
  },
  iconMedium: {
    width: 28,
    height: 28,
    resizeMode: 'contain',
  },
  iconChevron: {
    width: 20,
    height: 20,
    resizeMode: 'contain',
  },
  iconPlay: {
    width: 28,
    height: 28,
    resizeMode: 'contain',
  },
  iconLarge: {
    width: 34,
    height: 34,
    resizeMode: 'contain',
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
    backgroundColor: '#C8C5D0',
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
    backgroundColor: 'rgba(30, 25, 80, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    backgroundColor: 'rgba(30, 25, 80, 0.08)',
    borderRadius: 22,
    paddingHorizontal: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    color: '#1E1950',
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
    backgroundColor: 'rgba(30, 25, 80, 0.08)',
    borderRadius: 16,
  },
  langBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E1950',
  },

  // State A: Default Content
  defaultContent: {
    paddingTop: 4,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E1950',
    marginBottom: 14,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  recentIcon: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  recentLabel: {
    flex: 1,
    fontSize: 16,
    color: '#1E1950',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 25, 80, 0.06)',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#5E2B96',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  categoryIcon: {
    width: 48,
    height: 48,
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
    color: '#1E1950',
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
    color: '#7A7594',
  },
  noResultsText: {
    fontSize: 15,
    color: '#7A7594',
    marginTop: 16,
    paddingVertical: 20,
    textAlign: 'center',
  },
  resultCard: {
    backgroundColor: 'rgba(30, 25, 80, 0.06)',
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
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  resultIconGlobe: {
  },
  resultIconStar: {
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
    color: '#1E1950',
  },
  resultSubtitle: {
    fontSize: 14,
    color: '#5E5880',
    marginTop: 2,
  },
  guidesBtn: {
    marginTop: 12,
    backgroundColor: 'rgba(64, 196, 193, 0.15)',
    borderRadius: 20,
    paddingVertical: 10,
    alignItems: 'center',
  },
  guidesBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#40C4C1',
  },
  resultDivider: {
    height: 0,
  },

  // Confirm POI Button (floating above search panel)
  confirmPoiBtn: {
    position: 'absolute',
    bottom: SCREEN_HEIGHT * 0.55 + 16,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#40C4C1',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: '#40C4C1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  confirmPoiText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E1950',
  },

  // POI Player Modal
  poiModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  poiModalContent: {
    backgroundColor: '#1A1D20',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingTop: 28,
    shadowColor: '#5E2B96',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 16,
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(30, 25, 80, 0.06)',
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
    color: '#1E1950',
    marginBottom: 16,
    paddingRight: 40,
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
    color: '#5E5880',
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
    backgroundColor: '#5E2B96',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#5E2B96',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  playBtnActive: {
    backgroundColor: '#4A2278',
  },
  playBtnIcon: {
    fontSize: 24,
  },
  audioLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#2D2660',
  },
  noAudioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
  },
  mutedIcon: {
    fontSize: 28,
  },
  noAudioText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7A7594',
  },

  // Language Picker Modal
  langModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  langModalContent: {
    backgroundColor: '#1A1D20',
    borderRadius: 14,
    padding: 20,
    width: 220,
    shadowColor: '#5E2B96',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  langModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E1950',
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
    backgroundColor: 'rgba(64, 196, 193, 0.15)',
  },
  langOptionText: {
    fontSize: 16,
    color: '#2D2660',
  },
  langOptionTextSelected: {
    color: '#40C4C1',
    fontWeight: '600',
  },
  premiumVoiceDivider: {
    height: 1,
    backgroundColor: 'rgba(30, 25, 80, 0.06)',
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
    color: '#1E1950',
  },
  premiumVoiceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  premiumVoiceToggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  premiumVoiceToggleOn: {
    backgroundColor: '#40C4C1',
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
    color: '#9994A8',
    marginTop: 6,
    paddingHorizontal: 4,
  },
});
