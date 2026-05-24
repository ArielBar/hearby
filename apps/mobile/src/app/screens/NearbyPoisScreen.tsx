import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchNearbyPois, PoiWithDistance } from '../api/pois.api';
import { useLocation } from '../hooks/useLocation';
import { MapIcon } from '../components/icons/MapIcon';
import { ListIcon } from '../components/icons/ListIcon';
import { AppSplashScreen } from '../components/AppSplashScreen';
import { NavigationIcon } from '../components/icons/NavigationIcon';

type ViewMode = 'list' | 'map';

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
  const mapRef = useRef<MapView>(null);
  const cameraTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { location, error: locationError, loading: locationLoading } = useLocation();

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

  const pois = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data],
  );

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
    setSelectedPoi(poi);
    setShowDashedLine(true);
    setViewMode('map');

    const poiCoord = {
      latitude: poi.coordinates.coordinates[1],
      longitude: poi.coordinates.coordinates[0],
    };

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
          <View style={[styles.distanceBadge, { backgroundColor: colors.background, borderColor: colors.text }]}>
            <Text style={[styles.distanceText, { color: colors.text }]}>
              {distanceKm.toFixed(1)} ק"מ
            </Text>
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
      {viewMode === 'map' ? (<>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={region}
          showsUserLocation
          showsCompass
          showsMyLocationButton={false}
          onRegionChangeComplete={handleRegionChangeComplete}
        >
          {pois.map((poi) => (
            <Marker
              key={poi.id}
              coordinate={{
                latitude: poi.coordinates.coordinates[1],
                longitude: poi.coordinates.coordinates[0],
              }}
              title={poi.name}
              description={`${(poi.distanceInMeters / 1000).toFixed(1)} km away`}
              pinColor="#6366f1"
            />
          ))}
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
      </>) : (
        <FlatList
          style={styles.listContainer}
          data={pois}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={ListEmpty}
          contentContainerStyle={pois.length === 0 ? styles.listEmpty : styles.list}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
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
});
