import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  I18nManager,
  Image,
  Keyboard,
  Modal,
  NativeEventEmitter,
  NativeModules,
  Platform,
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
import { usePremium } from '../context/PremiumContext';
import { PaywallModal } from './PaywallModal';
import { FeatureFlags } from '../config/featureFlags';
import {
  RewardedAd,
  RewardedAdEventType,
  AdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';
import {
  X,
  Search,
  Clock,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Globe,
  Play,
  Pause,
  VolumeX,
  Mic,
} from 'lucide-react-native';

// Pre-instantiate the rewarded ad with Google Test ID (only if ads enabled)
const rewardedAd = FeatureFlags.ENABLE_ADS
  ? RewardedAd.createForAdRequest(TestIds.REWARDED, {
      requestNonPersonalizedAdsOnly: true,
    })
  : null;
const { HearbyTts } = NativeModules;
const ttsEmitter = new NativeEventEmitter(HearbyTts);
const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PANEL_MAX_HEIGHT = SCREEN_HEIGHT * 0.55;

// Unified color palette
const COLOR_DEEP_PLUM = '#453266'; // Primary Linework & Outlines
const COLOR_ROYAL_PURPLE = '#8D65B2'; // Accent Elements (Crown / Headphones)
const COLOR_TEAL_MINT = '#83C5BE'; // Main Body Fill (Location Pin)
const COLOR_SOFT_LAVENDER = '#B79ED4'; // Secondary Highlights / Shading
const COLOR_PASTEL_PINK = '#E295A3'; // Accent Detail (Tongue)
const COLOR_WHITE = '#FFFFFF'; // Background & Face Fill

// Icon color aliases
const ICON_COLOR = COLOR_TEAL_MINT;
const ICON_COLOR_MUTED = COLOR_TEAL_MINT;
const ICON_COLOR_TEAL = COLOR_TEAL_MINT;

// Cross-platform typography normalization
const FONT_FAMILY = Platform.OS === 'ios' ? 'Arial' : 'sans-serif';
const TEXT_BASE = {
  fontFamily: FONT_FAMILY,
  includeFontPadding: false,
  textAlignVertical: 'center' as const,
};

// Backend API URL (switches between local dev and production automatically)
import { ENV } from '../config/env';
import { getSignedHeaders } from '../config/apiAuth';
const BASE_URL = ENV.API_URL;

/** Generate authenticated headers — only in production */
function apiHeaders(path: string): Record<string, string> {
  // In development, still send signed headers when the app talks to a non-local API (e.g., production)
  if (__DEV__) {
    const host = ENV.API_URL || '';
    const isLocalHost = host.includes('localhost') || host.includes('10.0.2.2') || host.includes('127.0.0.1') || host.includes('192.168.');
    if (isLocalHost) return {};
  }
  return getSignedHeaders(path);
}

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
  en: '🇬🇧',
  he: '🇮🇱',
  es: '🇪🇸',
  fr: '🇫🇷',
  de: '🇩🇪',
  it: '🇮🇹',
  pt: '🇵🇹',
  ar: '🇸🇦',
  ru: '🇷🇺',
  ja: '🇯🇵',
  zh: '🇨🇳',
  ko: '🇰🇷',
  nl: '🇳🇱',
  pl: '🇵🇱',
  tr: '🇹🇷',
  th: '🇹🇭',
  hi: '🇮🇳',
  sv: '🇸🇪',
  da: '🇩🇰',
  fi: '🇫🇮',
  no: '🇳🇴',
  uk: '🇺🇦',
  el: '🇬🇷',
  cs: '🇨🇿',
  ro: '🇷🇴',
  hu: '🇭🇺',
  id: '🇮🇩',
  ms: '🇲🇾',
  vi: '🇻🇳',
};

/**
 * Get preferred languages from device settings (iOS: AppleLanguages)
 * Returns array of {code, label} based on the user's language preferences
 */
function getDevicePreferredLanguages(): { code: string; label: string }[] {
  try {
    const appleLanguages: string[] | undefined = Settings.get(
      'AppleLanguages',
    ) as string[] | undefined;

    if (appleLanguages && appleLanguages.length > 0) {
      const seen = new Set<string>();
      return appleLanguages
        .map((locale) => locale.split('_')[0].split('-')[0].toLowerCase())
        .filter((code) => {
          if (seen.has(code)) return false;
          seen.add(code);
          return true;
        })
        .map((code) => ({
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
  const res = await fetch(`${BASE_URL}/pois/enrich?${params}`, {
    headers: apiHeaders('/pois/enrich'),
  });

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

    const url = `${BASE_URL}/search/nominatim?${params}`;
    const res = await fetch(url, {
      headers: apiHeaders('/search/nominatim'),
    });

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
  radius: number = 500,
): Promise<NearbyPoi[]> {
  try {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lng: lng.toString(),
      lang: language,
      radius: radius.toString(),
    });
    const res = await fetch(`${BASE_URL}/search/nearby?${params}`, {
      headers: apiHeaders('/search/nearby'),
    });
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
  const { isPremium } = usePremium();
  const [showPaywall, setShowPaywall] = useState(false);

  // Detect device language once on mount (for Nominatim accept-language header)
  const [deviceLanguage, setDeviceLanguage] = useState(() =>
    getDeviceLanguage(),
  );
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [preferredLanguages] = useState(() => getDevicePreferredLanguages());

  // Load persisted language preference on mount
  useEffect(() => {
    AsyncStorage.getItem('hearby_lang').then((saved) => {
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
  const [recentSearches, setRecentSearches] = useState<AutocompleteResult[]>(
    [],
  );

  // Panel collapse state
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  // Track keyboard height to offset the search panel
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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
    AsyncStorage.getItem('hearby_recents').then((val) => {
      if (val) {
        try {
          setRecentSearches(JSON.parse(val));
        } catch {}
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
    AsyncStorage.getItem('hearby_premium_voice').then((val) => {
      if (val === 'true') setUsePremiumVoice(true);
    });
  }, []);

  const handleTogglePremiumVoice = useCallback((enabled: boolean) => {
    setUsePremiumVoice(enabled);
    AsyncStorage.setItem('hearby_premium_voice', enabled ? 'true' : 'false');
  }, []);

  // --- Rewarded Ad state machine (disabled for premium users or when ads flag is off) ---
  const [adLoaded, setAdLoaded] = useState(false);
  const pendingPlayAfterAdRef = useRef(false);

  useEffect(() => {
    // Skip ad loading if ads are disabled or user is premium
    if (!FeatureFlags.ENABLE_ADS || isPremium || !rewardedAd) {
      setAdLoaded(false);
      return;
    }

    const loadedUnsub = rewardedAd.addAdEventListener(
      RewardedAdEventType.LOADED,
      () => setAdLoaded(true),
    );
    const earnedUnsub = rewardedAd.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      () => {
        // Reward earned — playback will start on ad close
      },
    );
    const closedUnsub = rewardedAd.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        // Ad dismissed — start playback if pending
        if (pendingPlayAfterAdRef.current) {
          pendingPlayAfterAdRef.current = false;
          startAudioPlayback();
        }
        // Pre-load next ad
        setAdLoaded(false);
        rewardedAd.load();
      },
    );
    const errorUnsub = rewardedAd.addAdEventListener(AdEventType.ERROR, () => {
      // Ad failed — fallback: play immediately
      if (pendingPlayAfterAdRef.current) {
        pendingPlayAfterAdRef.current = false;
        startAudioPlayback();
      }
      setAdLoaded(false);
      // Retry loading after a brief delay
      setTimeout(() => rewardedAd.load(), 5000);
    });

    // Initial load
    rewardedAd.load();

    return () => {
      loadedUnsub();
      earnedUnsub();
      closedUnsub();
      errorUnsub();
    };
  }, [isPremium]);

  // Direction-aware layout based on selected language
  const rtl = useMemo(() => isRTL(deviceLanguage), [deviceLanguage]);
  const dirStyles = useMemo(
    () => ({
      row: { flexDirection: rtl ? 'row' : 'row-reverse' } as const,
      textAlign: { textAlign: rtl ? 'right' : 'left' } as const,
      writingDirection: { writingDirection: rtl ? 'rtl' : 'ltr' } as const,
    }),
    [rtl],
  );

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
      setRecentSearches((prev) => {
        const filtered = prev.filter((r) => r.title !== entry.title);
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
    setRecentSearches((prev) => {
      const filtered = prev.filter((r) => r.title !== result.title);
      const updated = [result, ...filtered].slice(0, 8);
      AsyncStorage.setItem('hearby_recents', JSON.stringify(updated));
      return updated;
    });
    console.log(
      '[NearbyPoisScreen] Search result selected:',
      result.title,
      result.type,
    );

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
        1000,
      );

      // Clear any existing marker/selection (don't trigger POI fetch)
      setTempMarkerCoords(null);
      setSelectedCoordinate(null);
    } else {
      // POI: Tight zoom, place marker, trigger enrichment immediately
      console.log('[NearbyPoisScreen] Flying to POI with tight zoom');

      mapRef.current?.animateToRegion(
        {
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          latitudeDelta: 0.008, // Immersive zoom for landmarks
          longitudeDelta: 0.008,
        },
        800,
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
  const startAudioPlayback = useCallback(() => {
    if (!poiData?.masterScript) return;

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
  }, [poiData, usePremiumVoice, deviceLanguage]);

  const handlePlayPause = useCallback(() => {
    if (!poiData?.masterScript) return;

    if (isPlaying) {
      // Toggle pause/resume on currently playing audio
      if (isPaused) {
        HearbyTts.resume();
      } else {
        HearbyTts.pause();
      }
    } else {
      // Ads disabled or premium — play immediately
      if (!FeatureFlags.ENABLE_ADS || isPremium) {
        startAudioPlayback();
        return;
      }
      // New playback request — show ad wall if available
      if (adLoaded && rewardedAd) {
        pendingPlayAfterAdRef.current = true;
        rewardedAd.show();
      } else {
        // Ad not loaded — seamless fallback, play immediately
        startAudioPlayback();
      }
    }
  }, [poiData, isPlaying, isPaused, isPremium, adLoaded, startAudioPlayback]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Free Exploration Map — Google Maps on both platforms */}
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
        toolbarEnabled={false}
        zoomControlEnabled={false}
        mapPadding={{ top: 0, right: 0, bottom: PANEL_MAX_HEIGHT, left: 0 }}
        onPress={(e) => handleMapPress(e.nativeEvent.coordinate)}
      >
        {/* Custom marker at tapped location */}
        {tempMarkerCoords && (
          <Marker
            coordinate={tempMarkerCoords}
            title={poiData?.name || 'טוען...'}
          >
            <View style={styles.customMarker}>
              <MapPin size={22} color="#FFFFFF" fill={ICON_COLOR_TEAL} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* My Location Button */}
      <TouchableOpacity
        style={[styles.myLocationBtn, { top: insets.top + 12 }]}
        activeOpacity={0.7}
        onPress={async () => {
          // Request permission first (iOS needs explicit authorization)
          if (Platform.OS === 'ios') {
            Geolocation.requestAuthorization('whenInUse');
          }
          Geolocation.getCurrentPosition(
            (position) => {
              mapRef.current?.animateToRegion(
                {
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                  latitudeDelta: 0.005,
                  longitudeDelta: 0.005,
                },
                500,
              );
            },
            (error) => console.warn('[Location] Error:', error.message),
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 },
          );
        }}
      >
        <Globe size={24} color={ICON_COLOR} />
      </TouchableOpacity>

      {/* Apple Maps-Style Search Panel */}
      <Animated.View
        style={[
          styles.searchPanel,
          { maxHeight: isPanelCollapsed ? 36 : PANEL_MAX_HEIGHT },
          keyboardHeight > 0 && { bottom: keyboardHeight },
        ]}
      >
        {/* Drag Handle — tap to collapse/expand */}
        <TouchableOpacity
          style={styles.dragHandle}
          activeOpacity={0.7}
          onPress={() => setIsPanelCollapsed((prev) => !prev)}
        >
          <View style={styles.dragHandleBar} />
        </TouchableOpacity>

        {!isPanelCollapsed && (
          <>
            {/* Header Row: Close + Search Input */}
            <View style={[styles.searchHeader, dirStyles.row]}>
              <TouchableOpacity
                style={styles.closeSearchBtn}
                onPress={handleCancelSearch}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <X size={20} color={ICON_COLOR} />
              </TouchableOpacity>

              <View style={styles.searchInputWrapper}>
                <TextInput
                  style={[
                    styles.searchInput,
                    dirStyles.textAlign,
                    dirStyles.writingDirection,
                  ]}
                  placeholder={t(deviceLanguage, 'searchPlaceholder')}
                  placeholderTextColor="#B79ED4"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onFocus={() => setIsSearchFocused(true)}
                  returnKeyType="search"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <View style={styles.searchInputIcon}>
                  <Search size={20} color={ICON_COLOR_MUTED} />
                </View>
              </View>

              <TouchableOpacity
                style={styles.langBadge}
                onPress={() => setShowLangPicker(true)}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <Text style={styles.langBadgeText}>
                  {LANG_FLAGS[deviceLanguage] || '🌐'}{' '}
                  {deviceLanguage.toUpperCase()}
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
                      <Text style={[styles.sectionTitle, dirStyles.textAlign]}>
                        {t(deviceLanguage, 'recents')}
                      </Text>
                      {recentSearches.map((item, idx) => (
                        <TouchableOpacity
                          key={`recent-${idx}`}
                          style={[styles.recentRow, dirStyles.row]}
                          activeOpacity={0.7}
                          onPress={() => handleSearchResultSelect(item)}
                        >
                          <View style={styles.recentIcon}>
                            <Clock size={18} color={ICON_COLOR} />
                          </View>
                          <Text
                            style={[styles.recentLabel, dirStyles.textAlign]}
                            numberOfLines={1}
                          >
                            {item.title}
                          </Text>
                          {rtl ? (
                            <ChevronLeft size={20} color={ICON_COLOR_MUTED} />
                          ) : (
                            <ChevronRight size={20} color={ICON_COLOR_MUTED} />
                          )}
                        </TouchableOpacity>
                      ))}
                    </>
                  )}

                  {/* Nearby Exploration Section */}
                  <Text
                    style={[
                      styles.sectionTitle,
                      dirStyles.textAlign,
                      recentSearches.length > 0 && { marginTop: 20 },
                    ]}
                  >
                    {t(deviceLanguage, 'nearbyExploration')}
                  </Text>
                  <TouchableOpacity
                    style={[styles.categoryRow, dirStyles.row]}
                    activeOpacity={0.7}
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
                          console.warn(
                            '[NearbyPoisScreen] GPS error, falling back to map center:',
                            error.message,
                          );
                          mapRef.current?.getCamera().then((camera) => {
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
                        {
                          enableHighAccuracy: true,
                          timeout: 5000,
                          maximumAge: 10000,
                        },
                      );
                    }}
                  >
                    <View style={styles.categoryIcon}>
                      <MapPin size={24} color={ICON_COLOR} />
                    </View>
                    <Text style={[styles.categoryLabel, dirStyles.textAlign]}>
                      {t(deviceLanguage, 'landmarks')}
                    </Text>
                    {rtl ? (
                      <ChevronLeft size={20} color={ICON_COLOR_MUTED} />
                    ) : (
                      <ChevronRight size={20} color={ICON_COLOR_MUTED} />
                    )}
                  </TouchableOpacity>

                  {/* Nearby POIs results */}
                  {isLoadingNearby && (
                    <View style={[styles.loadingState, { marginTop: 12 }]}>
                      <ActivityIndicator size="small" color="#40C4C1" />
                    </View>
                  )}
                  {nearbySearchDone &&
                    !isLoadingNearby &&
                    nearbyPois.length === 0 && (
                      <Text style={[styles.noResultsText, dirStyles.textAlign]}>
                        {t(deviceLanguage, 'noPlacesFound')}
                      </Text>
                    )}
                  {nearbyPois.length > 0 && (
                    <View style={{ marginTop: 12 }}>
                      {nearbyPois.map((item, index) => (
                        <TouchableOpacity
                          key={`nearby-${item.title}-${index}`}
                          style={styles.resultCard}
                          activeOpacity={0.7}
                          onPress={() => {
                            const coord: Coordinate = {
                              latitude: item.lat,
                              longitude: item.lng,
                            };
                            setTempMarkerCoords(coord);
                            setSelectedCoordinate(coord);
                            setNearbyPois([]);
                            setNearbySearchDone(false);
                          }}
                        >
                          <View style={styles.categoryIcon}>
                            <MapPin size={24} color={ICON_COLOR} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[styles.resultTitle, dirStyles.textAlign]}
                            >
                              {item.title}
                            </Text>
                            {item.description ? (
                              <Text
                                style={[
                                  styles.resultSubtitle,
                                  dirStyles.textAlign,
                                ]}
                                numberOfLines={1}
                              >
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
                    <View>
                      {searchResults.map((item, index) => {
                        const isTopMatch = index === 0 && item.type === 'city';
                        return (
                          <React.Fragment key={`${item.title}-${index}`}>
                            {index > 0 && <View style={styles.resultDivider} />}
                            <TouchableOpacity
                              style={[
                                styles.resultCard,
                                isTopMatch && styles.resultCardTop,
                              ]}
                              onPress={() => handleSearchResultSelect(item)}
                              activeOpacity={0.7}
                            >
                              <View style={[styles.resultRow, dirStyles.row]}>
                                <View
                                  style={[
                                    styles.resultIconCircle,
                                    isTopMatch
                                      ? styles.resultIconGlobe
                                      : styles.resultIconStar,
                                  ]}
                                >
                                  {item.type === 'city' ? (
                                    <Globe size={24} color={ICON_COLOR} />
                                  ) : (
                                    <MapPin size={24} color={ICON_COLOR} />
                                  )}
                                </View>
                                <View style={styles.resultTextBlock}>
                                  <Text
                                    style={[
                                      styles.resultTitle,
                                      dirStyles.textAlign,
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {item.title}
                                  </Text>
                                  {item.description ? (
                                    <Text
                                      style={[
                                        styles.resultSubtitle,
                                        dirStyles.textAlign,
                                      ]}
                                      numberOfLines={1}
                                    >
                                      {item.description}
                                    </Text>
                                  ) : null}
                                </View>
                              </View>
                              {isTopMatch && (
                                <View style={styles.guidesBtn}>
                                  <Text style={styles.guidesBtnText}>
                                    {t(deviceLanguage, 'guides')}
                                  </Text>
                                </View>
                              )}
                            </TouchableOpacity>
                          </React.Fragment>
                        );
                      })}
                    </View>
                  ) : (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyText}>
                        {t(deviceLanguage, 'noResults')}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>
          </>
        )}
      </Animated.View>

      {/* Confirm POI Button - shown when marker placed but not yet confirmed */}
      {tempMarkerCoords && !selectedCoordinate && (
        <TouchableOpacity
          style={styles.confirmPoiBtn}
          onPress={handleConfirmPoi}
          activeOpacity={0.7}
        >
          <MapPin size={20} color="#FFFFFF" />
          <Text style={styles.confirmPoiText}>
            {t(deviceLanguage, 'explorePoi')}
          </Text>
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
          <View
            style={[
              styles.poiModalContent,
              { paddingBottom: insets.bottom + 20 },
            ]}
          >
            {/* Close button */}
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={handleClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={20} color={ICON_COLOR} />
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
                <Text style={styles.loadingText}>
                  {t(deviceLanguage, 'loading')}
                </Text>
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
                  activeOpacity={0.7}
                >
                  {isPlaying && !isPaused ? (
                    <Pause size={28} color={ICON_COLOR} />
                  ) : (
                    <Play size={28} color={ICON_COLOR} />
                  )}
                </TouchableOpacity>
                <Text style={[styles.audioLabel, dirStyles.textAlign]}>
                  {isPlaying && !isPaused
                    ? t(deviceLanguage, 'nowPlaying')
                    : t(deviceLanguage, 'playAudio')}
                </Text>
              </View>
            )}

            {/* No audio content */}
            {!isLoading && !poiData?.masterScript && !isLoading && (
              <View style={styles.noAudioContainer}>
                <VolumeX size={28} color={ICON_COLOR_MUTED} />
                <Text style={styles.noAudioText}>
                  {t(deviceLanguage, 'noAudio')}
                </Text>
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
            {preferredLanguages.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.langOption,
                  lang.code === deviceLanguage && styles.langOptionSelected,
                ]}
                onPress={() => handleLanguageChange(lang.code)}
              >
                <Text
                  style={[
                    styles.langOptionText,
                    lang.code === deviceLanguage &&
                      styles.langOptionTextSelected,
                  ]}
                >
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
                <Mic size={16} color={ICON_COLOR} />
                <Text style={styles.premiumVoiceLabel}>Premium AI Voice</Text>
              </View>
              <View
                style={[
                  styles.premiumVoiceToggle,
                  usePremiumVoice && styles.premiumVoiceToggleOn,
                ]}
              >
                <View
                  style={[
                    styles.premiumVoiceThumb,
                    usePremiumVoice && styles.premiumVoiceThumbOn,
                  ]}
                />
              </View>
            </TouchableOpacity>
            <Text style={styles.premiumVoiceHint}>
              {usePremiumVoice
                ? 'OpenAI TTS (costs apply)'
                : 'On-device Siri voice (free)'}
            </Text>

            {/* Upgrade to Premium CTA */}
            {FeatureFlags.ENABLE_PURCHASES && !isPremium && (
              <>
                <View style={styles.premiumVoiceDivider} />
                <TouchableOpacity
                  style={styles.upgradePremiumBtn}
                  onPress={() => setShowPaywall(true)}
                  activeOpacity={0.8}
                >
                  <Image
                    source={require('../assets/premium-icon.png')}
                    style={styles.upgradePremiumIcon}
                  />
                  <Text style={styles.upgradePremiumBtnText}>
                    {' '}
                    שדרג ל-Premium
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Paywall Modal */}
      <PaywallModal
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
      />
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
  customMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f59e0b',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  myLocationBtn: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },

  // Apple Maps Search Panel (Bottom Card)
  searchPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#F2F2F7',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 16,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 24,
    overflow: 'hidden',
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
    backgroundColor: '#E5E5EA',
    justifyContent: 'center',
    alignItems: 'center',
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
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    flex: 1,
    fontSize: 17,
    color: '#453266',
    paddingVertical: 0,
  },
  searchInputIcon: {
    marginLeft: 8,
  },
  langBadge: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(30, 25, 80, 0.08)',
    borderRadius: 16,
  },
  langBadgeText: {
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: '#453266',
  },

  // State A: Default Content
  defaultContent: {
    paddingTop: 4,
  },
  sectionTitle: {
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: '#453266',
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
    marginRight: 8,
  },
  recentLabel: {
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    flex: 1,
    fontSize: 16,
    color: '#453266',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  categoryIcon: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  categoryLabel: {
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#453266',
    textAlign: 'right',
  },
  categoryChevron: {
    color: '#453266',
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
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 17,
    color: '#B79ED4',
  },
  noResultsText: {
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 15,
    color: '#B79ED4',
    marginTop: 16,
    paddingVertical: 20,
    textAlign: 'center',
  },
  resultCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginHorizontal: 0,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
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
  resultIconGlobe: {},
  resultIconStar: {},
  resultTextBlock: {
    flex: 1,
    alignItems: 'flex-end',
  },
  resultTitle: {
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: '#453266',
  },
  resultSubtitle: {
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 14,
    color: '#8D65B2',
    marginTop: 2,
  },
  guidesBtn: {
    marginTop: 12,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    borderRadius: 20,
    paddingVertical: 10,
    alignItems: 'center',
  },
  guidesBtnText: {
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: '#83C5BE',
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
    backgroundColor: '#83C5BE',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: '#83C5BE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  confirmPoiText: {
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: '#453266',
  },

  // POI Player Modal
  poiModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  poiModalContent: {
    backgroundColor: '#F2F2F7',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingTop: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 10,
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E5E5EA',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  title: {
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 22,
    fontWeight: '700',
    color: '#453266',
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
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 14,
    color: '#8D65B2',
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
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  playBtnActive: {
    backgroundColor: '#E5E5EA',
  },
  audioLabel: {
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#453266',
  },
  noAudioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 20,
    backgroundColor: '#E5E5EA',
    borderRadius: 12,
  },
  noAudioText: {
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: '#B79ED4',
  },

  // Language Picker Modal
  langModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  langModalContent: {
    backgroundColor: 'rgba(245, 247, 250, 0.94)',
    borderRadius: 32,
    padding: 20,
    width: 220,
    shadowColor: '#453266',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 24,
  },
  langModalTitle: {
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: '#453266',
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
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 16,
    color: '#453266',
  },
  langOptionTextSelected: {
    color: '#83C5BE',
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
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: '#453266',
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
    backgroundColor: 'rgba(30, 25, 80, 0.12)',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  premiumVoiceToggleOn: {
    backgroundColor: '#83C5BE',
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
    fontFamily: FONT_FAMILY,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontSize: 11,
    color: '#453266',
    marginTop: 6,
    paddingHorizontal: 4,
  },
  upgradePremiumBtn: {
    backgroundColor: '#7C3AED',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 12,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  upgradePremiumBtnText: {
    fontFamily: FONT_FAMILY,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    writingDirection: 'rtl',
  },
  upgradePremiumIcon: {
    width: 22,
    height: 22,
    resizeMode: 'contain',
  },
});
