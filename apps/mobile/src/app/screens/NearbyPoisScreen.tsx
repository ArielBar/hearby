import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  NativeEventEmitter,
  NativeModules,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

const { HearbyTts } = NativeModules;
const ttsEmitter = new NativeEventEmitter(HearbyTts);
import { fetchNearbyPois, PoiWithDistance } from '../api/pois.api';
import { fetchWikipediaSummary } from '../api/wikipedia.api';
import { useLocation } from '../hooks/useLocation';
import { MapIcon } from '../components/icons/MapIcon';
import { ListIcon } from '../components/icons/ListIcon';
import { AppSplashScreen } from '../components/AppSplashScreen';
import { NavigationIcon } from '../components/icons/NavigationIcon';
import { NavArrowIcon } from '../components/icons/NavArrowIcon';
import { SearchIcon } from '../components/icons/SearchIcon';
import { VolumeIcon } from '../components/icons/VolumeIcon';
import { PlayPauseIcon } from '../components/icons/PlayPauseIcon';
import { openNavigationMenu } from '../utils/navigation';

type ViewMode = 'list' | 'map';
type DistanceTier = 'all' | 'green' | 'orange' | 'red';

interface DistanceColors {
  background: string;
  text: string;
}

function getDistanceColors(distanceKm: number): DistanceColors {
  if (distanceKm <= 1.0) {
    return { background: '#f0fdf4', text: '#16a34a' };
  }
  if (distanceKm <= 3.0) {
    return { background: '#fff7ed', text: '#ea580c' };
  }
  return { background: '#fef2f2', text: '#dc2626' };
}

const LATITUDE_DELTA = 0.02;
const LONGITUDE_DELTA = 0.02;

// Pulsing marker component for the currently-speaking POI
function PulsingMarker({ coordinate, title, onPress }: {
  coordinate: { latitude: number; longitude: number };
  title: string;
  onPress: () => void;
}) {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  const scale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.0, 1.5],
  });

  const opacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 0.2],
  });

  return (
    <Marker coordinate={coordinate} title={title} onPress={onPress}>
      <View style={pulsingStyles.container}>
        <Animated.View
          style={[
            pulsingStyles.halo,
            { transform: [{ scale }], opacity },
          ]}
        />
        <View style={pulsingStyles.pin} />
      </View>
    </Marker>
  );
}

const pulsingStyles = StyleSheet.create({
  container: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f59e0b',
  },
  pin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#4338ca',
    borderWidth: 3,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
});

function ListEmpty() {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>
        לא נמצאו נקודות עניין באזור זה.{'\n'}נסה לרענן או להגדיל את הרדיוס.
      </Text>
    </View>
  );
}

export function NearbyPoisScreen() {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [minSplashDone, setMinSplashDone] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<PoiWithDistance | null>(null);
  const [isUserVisible, setIsUserVisible] = useState(true);
  const [showDashedLine, setShowDashedLine] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDistanceTier, setSelectedDistanceTier] = useState<DistanceTier>('all');
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentlyPlayingPoiId, setCurrentlyPlayingPoiId] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);
  const cameraTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { location, error: locationError, loading: locationLoading } = useLocation();

  // TTS initialization and event listeners
  useEffect(() => {
    HearbyTts.setLanguage('he-IL');
    HearbyTts.activateAudioSession();

    const finishSub = ttsEmitter.addListener('tts-finish', () => {
      setCurrentlyPlayingPoiId(null);
      setIsPaused(false);
    });
    const cancelSub = ttsEmitter.addListener('tts-cancel', () => {
      setCurrentlyPlayingPoiId(null);
      setIsPaused(false);
    });
    const pauseSub = ttsEmitter.addListener('tts-pause', () => {
      setIsPaused(true);
    });
    const resumeSub = ttsEmitter.addListener('tts-resume', () => {
      setIsPaused(false);
    });

    return () => {
      HearbyTts.stop();
      finishSub.remove();
      cancelSub.remove();
      pauseSub.remove();
      resumeSub.remove();
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setMinSplashDone(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    isRefetching,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['pois', location?.lat, location?.lng],
    queryFn: ({ pageParam = 1 }) =>
      fetchNearbyPois(location!.lat, location!.lng, pageParam),
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNextPage ? lastPage.meta.page + 1 : undefined,
    enabled: !!location,
    initialPageParam: 1,
  });

  // Wikipedia summary for selected POI
  const { data: wikiData } = useQuery({
    queryKey: ['wikipedia', selectedPoi?.name],
    queryFn: () => fetchWikipediaSummary(selectedPoi!.name),
    enabled: !!selectedPoi,
  });

  // Manual TTS play handler
  const handlePlayTts = useCallback(() => {
    if (!wikiData?.summary || isMuted) return;
    HearbyTts.stop();
    setIsPaused(false);
    setCurrentlyPlayingPoiId(selectedPoi?.id ?? null);
    HearbyTts.speak(wikiData.summary);
  }, [wikiData, isMuted, selectedPoi]);

  // Stop TTS when muted or POI deselected
  useEffect(() => {
    if (isMuted || !selectedPoi) {
      HearbyTts.stop();
      setCurrentlyPlayingPoiId(null);
      setIsPaused(false);
    }
  }, [isMuted, selectedPoi]);

  const pois = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data],
  );

  const filteredPois = useMemo(() => {
    let result = pois;

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((poi) => poi.name.toLowerCase().includes(query));
    }

    if (selectedDistanceTier !== 'all') {
      result = result.filter((poi) => {
        const km = poi.distanceInMeters / 1000;
        switch (selectedDistanceTier) {
          case 'green': return km <= 1.0;
          case 'orange': return km > 1.0 && km <= 3.0;
          case 'red': return km > 3.0;
        }
      });
    }

    return result;
  }, [pois, searchQuery, selectedDistanceTier]);

  const region: Region | undefined = useMemo(
    () =>
      location
        ? {
            latitude: location.lat,
            longitude: location.lng,
            latitudeDelta: LATITUDE_DELTA,
            longitudeDelta: LONGITUDE_DELTA,
          }
        : undefined,
    [location],
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === 'list' ? 'map' : 'list'));
  }, []);

  const handleRegionChangeComplete = useCallback(
    (newRegion: Region) => {
      if (!location) return;
      const latMin = newRegion.latitude - newRegion.latitudeDelta / 2;
      const latMax = newRegion.latitude + newRegion.latitudeDelta / 2;
      const lngMin = newRegion.longitude - newRegion.longitudeDelta / 2;
      const lngMax = newRegion.longitude + newRegion.longitudeDelta / 2;

      const inBounds =
        location.lat >= latMin &&
        location.lat <= latMax &&
        location.lng >= lngMin &&
        location.lng <= lngMax;

      setIsUserVisible(inBounds);
    },
    [location],
  );

  const clearCameraTimeout = useCallback(() => {
    if (cameraTimeoutRef.current) {
      clearTimeout(cameraTimeoutRef.current);
      cameraTimeoutRef.current = null;
    }
  }, []);

  const handleRecenter = useCallback(() => {
    if (!location) return;
    clearCameraTimeout();
    setShowDashedLine(false);
    mapRef.current?.animateToRegion(
      {
        latitude: location.lat,
        longitude: location.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      },
      500,
    );
  }, [location, clearCameraTimeout]);

  const handlePoiSelect = useCallback((poi: PoiWithDistance) => {
    clearCameraTimeout();
    HearbyTts.stop();
    setCurrentlyPlayingPoiId(null);
    setIsPaused(false);
    setSelectedPoi(poi);
    setShowDashedLine(true);
    setViewMode('map');

    const poiCoord = {
      latitude: poi.coordinates.coordinates[1],
      longitude: poi.coordinates.coordinates[0],
    };

    // Debug: copy coordinates to clipboard
    Clipboard.setString(`${poiCoord.latitude}, ${poiCoord.longitude}`);

    setTimeout(() => {
      if (location) {
        const userCoord = { latitude: location.lat, longitude: location.lng };
        mapRef.current?.fitToCoordinates([userCoord, poiCoord], {
          edgePadding: { top: 80, right: 80, bottom: 120, left: 80 },
          animated: true,
        });
      } else {
        mapRef.current?.animateToRegion(
          { ...poiCoord, latitudeDelta: 0.005, longitudeDelta: 0.005 },
          600,
        );
      }

      // After 4s, hide line and zoom into the POI
      cameraTimeoutRef.current = setTimeout(() => {
        setShowDashedLine(false);
        mapRef.current?.animateToRegion(
          { ...poiCoord, latitudeDelta: 0.005, longitudeDelta: 0.005 },
          800,
        );
        cameraTimeoutRef.current = null;
      }, 4000);
    }, 150);
  }, [location, clearCameraTimeout]);

  const renderItem = useCallback(
    ({ item }: { item: PoiWithDistance }) => {
      const distanceKm = item.distanceInMeters / 1000;
      const colors = getDistanceColors(distanceKm);
      return (
        <TouchableOpacity style={styles.card} onPress={() => handlePoiSelect(item)} activeOpacity={0.7}>
          <Text style={styles.name}>{item.name}</Text>
          <View style={styles.cardActions}>
            <View style={[styles.distanceBadge, { backgroundColor: colors.background, borderColor: colors.text }]}>
              <Text style={[styles.distanceText, { color: colors.text }]}>
                {distanceKm.toFixed(1)} ק"מ
              </Text>
            </View>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={(e) => {
                e.stopPropagation();
                openNavigationMenu(
                  item.coordinates.coordinates[1],
                  item.coordinates.coordinates[0],
                  item.name,
                );
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <NavArrowIcon size={18} color="#6366f1" />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      );
    },
    [handlePoiSelect],
  );

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color="#6366f1" />
      </View>
    );
  }, [isFetchingNextPage]);

  if (!minSplashDone || locationLoading || isLoading) {
    return <AppSplashScreen />;
  }

  if (locationError || isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          {locationError || 'Failed to load nearby places.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search & Filter Header */}
      <View style={styles.filterHeader}>
        <View style={styles.searchContainer}>
          <SearchIcon size={18} color="#94a3b8" />
          <TextInput
            style={styles.searchInput}
            placeholder="חפש נקודת עניין..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContainer}
        >
          <TouchableOpacity
            style={[
              styles.chip,
              selectedDistanceTier === 'green' && styles.chipGreenActive,
            ]}
            onPress={() => setSelectedDistanceTier((prev) => prev === 'green' ? 'all' : 'green')}
          >
            <Text style={[styles.chipText, selectedDistanceTier === 'green' && styles.chipGreenText]}>
              קרוב (עד 1 ק"מ)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.chip,
              selectedDistanceTier === 'orange' && styles.chipOrangeActive,
            ]}
            onPress={() => setSelectedDistanceTier((prev) => prev === 'orange' ? 'all' : 'orange')}
          >
            <Text style={[styles.chipText, selectedDistanceTier === 'orange' && styles.chipOrangeText]}>
              בינוני (1-3 ק"מ)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.chip,
              selectedDistanceTier === 'red' && styles.chipRedActive,
            ]}
            onPress={() => setSelectedDistanceTier((prev) => prev === 'red' ? 'all' : 'red')}
          >
            <Text style={[styles.chipText, selectedDistanceTier === 'red' && styles.chipRedText]}>
              רחוק (מעל 3 ק"מ)
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {viewMode === 'map' ? (<>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={region}
          showsUserLocation
          showsCompass
          showsMyLocationButton={false}
          onRegionChangeComplete={handleRegionChangeComplete}
          onPress={() => setSelectedPoi(null)}
        >
          {filteredPois.map((poi) =>
            currentlyPlayingPoiId === poi.id ? (
              <PulsingMarker
                key={poi.id}
                coordinate={{
                  latitude: poi.coordinates.coordinates[1],
                  longitude: poi.coordinates.coordinates[0],
                }}
                title={poi.name}
                onPress={() => {
                  setSelectedPoi(poi);
                  setShowDashedLine(true);
                }}
              />
            ) : (
              <Marker
                key={poi.id}
                coordinate={{
                  latitude: poi.coordinates.coordinates[1],
                  longitude: poi.coordinates.coordinates[0],
                }}
                title={poi.name}
                description={`${(poi.distanceInMeters / 1000).toFixed(1)} km away`}
                pinColor={selectedPoi?.id === poi.id ? '#4338ca' : '#6366f1'}
                onPress={() => {
                  setSelectedPoi(poi);
                  setShowDashedLine(true);
                }}
              />
            ),
          )}
          {showDashedLine && selectedPoi && location && (
            <Polyline
              coordinates={[
                { latitude: location.lat, longitude: location.lng },
                {
                  latitude: selectedPoi.coordinates.coordinates[1],
                  longitude: selectedPoi.coordinates.coordinates[0],
                },
              ]}
              strokeColor="#6366f1"
              strokeWidth={3}
              lineDashPattern={[5, 5]}
            />
          )}
        </MapView>
        {!isUserVisible && location && (
          <TouchableOpacity
            style={styles.recenterBtn}
            onPress={handleRecenter}
            activeOpacity={0.85}
          >
            <NavigationIcon size={20} color="#ffffff" />
          </TouchableOpacity>
        )}
        {selectedPoi && (
          <View style={styles.previewCard}>
            {/* Close button - top right */}
            <TouchableOpacity
              style={styles.previewClose}
              onPress={() => setSelectedPoi(null)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.previewCloseText}>✕</Text>
            </TouchableOpacity>

            <View style={styles.previewContent}>
              {/* Left: Info stack */}
              <View style={styles.previewInfo}>
                <Text style={styles.previewName} numberOfLines={2}>
                  {selectedPoi.name}
                </Text>
                {(() => {
                  const km = selectedPoi.distanceInMeters / 1000;
                  const colors = getDistanceColors(km);
                  return (
                    <View style={[styles.previewBadge, { backgroundColor: colors.background, borderColor: colors.text }]}>
                      <Text style={[styles.previewBadgeText, { color: colors.text }]}>
                        {km.toFixed(1)} ק"מ
                      </Text>
                    </View>
                  );
                })()}
              </View>

              {/* Right: Navigate button */}
              <TouchableOpacity
                style={styles.previewNavBtn}
                onPress={() =>
                  openNavigationMenu(
                    selectedPoi.coordinates.coordinates[1],
                    selectedPoi.coordinates.coordinates[0],
                    selectedPoi.name,
                  )
                }
                activeOpacity={0.8}
              >
                <NavArrowIcon size={16} color="#ffffff" />
                <Text style={styles.previewNavText}>נווט</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </>) : (
        <FlatList
          style={styles.listContainer}
          data={filteredPois}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={ListEmpty}
          contentContainerStyle={filteredPois.length === 0 ? styles.listEmpty : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefresh}
              tintColor="#6366f1"
              colors={['#6366f1']}
            />
          }
        />
      )}

      {/* Floating toggle button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={toggleViewMode}
        activeOpacity={0.85}
      >
        {viewMode === 'list' ? <MapIcon size={20} color="#ffffff" /> : <ListIcon size={20} color="#ffffff" />}
        <Text style={styles.fabText}>
          {viewMode === 'list' ? 'תצוגת מפה' : 'תצוגת רשימה'}
        </Text>
      </TouchableOpacity>

      {/* Floating mute button */}
      <TouchableOpacity
        style={[styles.muteBtn, isMuted && styles.muteBtnMuted]}
        onPress={() => {
          setIsMuted((prev) => {
            if (!prev) {
              HearbyTts.stop();
              setCurrentlyPlayingPoiId(null);
              setIsPaused(false);
            }
            return !prev;
          });
        }}
        activeOpacity={0.85}
      >
        <VolumeIcon size={20} color={isMuted ? '#64748b' : '#ffffff'} muted={isMuted} />
      </TouchableOpacity>

      {/* Floating pause/play button */}
      {wikiData?.summary && !isMuted && (
        <TouchableOpacity
          style={styles.pauseBtn}
          onPress={() => {
            if (!currentlyPlayingPoiId) {
              handlePlayTts();
            } else if (isPaused) {
              HearbyTts.resume();
            } else {
              HearbyTts.pause();
            }
          }}
          activeOpacity={0.85}
        >
          <PlayPauseIcon
            size={20}
            color="#ffffff"
            paused={!currentlyPlayingPoiId || isPaused}
          />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  filterHeader: {
    backgroundColor: '#ffffff',
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 16,
    zIndex: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 3,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#1e293b',
    textAlign: 'right',
    padding: 0,
  },
  chipsContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 10,
  },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  chipGreenActive: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  chipGreenText: {
    color: '#16a34a',
  },
  chipOrangeActive: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#ea580c',
  },
  chipOrangeText: {
    color: '#ea580c',
  },
  chipRedActive: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#dc2626',
  },
  chipRedText: {
    color: '#dc2626',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  map: {
    flex: 1,
  },
  listContainer: {
    flex: 1,
  },
  list: {
    padding: 16,
  },
  listEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 15,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    flex: 1,
  },
  distance: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6366f1',
    marginLeft: 12,
  },
  distanceBadge: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginLeft: 12,
  },
  distanceText: {
    fontSize: 13,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#ef4444',
  },
  fab: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 28,
    zIndex: 10,
    shadowColor: '#4338ca',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  fabText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  recenterBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: '#4338ca',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },
  muteBtn: {
    position: 'absolute',
    bottom: 32,
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: '#4338ca',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  muteBtnMuted: {
    backgroundColor: '#e2e8f0',
  },
  pauseBtn: {
    position: 'absolute',
    bottom: 32,
    left: 72,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: '#4338ca',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  previewCard: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    right: 16,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    zIndex: 20,
    shadowColor: '#1e293b',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  previewClose: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  previewCloseText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#94a3b8',
    lineHeight: 16,
  },
  previewContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewInfo: {
    flex: 1,
    marginRight: 16,
    gap: 10,
  },
  previewName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1e293b',
    paddingRight: 36,
  },
  previewBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  previewBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  previewNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  previewNavText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
});
