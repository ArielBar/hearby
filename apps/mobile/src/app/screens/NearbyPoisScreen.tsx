import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchNearbyPois, PoiWithDistance } from '../api/pois.api';
import { useLocation } from '../hooks/useLocation';

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
  const { location, error: locationError, loading: locationLoading } = useLocation();

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

  const renderItem = useCallback(
    ({ item }: { item: PoiWithDistance }) => (
      <View style={styles.card}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.distance}>
          {(item.distanceInMeters / 1000).toFixed(1)} km
        </Text>
      </View>
    ),
    [],
  );

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color="#6366f1" />
      </View>
    );
  }, [isFetchingNextPage]);

  // Full-screen spinner only for initial load
  if (locationLoading || isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
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
      {/* Map — top 40% */}
      <View style={styles.mapContainer}>
        <MapView
          style={styles.map}
          initialRegion={region}
          showsUserLocation
          showsCompass
          showsMyLocationButton
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
        </MapView>
      </View>

      {/* List — bottom 60% */}
      <View style={styles.listContainer}>
        <FlatList
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
      </View>
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
  mapContainer: {
    flex: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  listContainer: {
    flex: 6,
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
  footer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#ef4444',
  },
});
