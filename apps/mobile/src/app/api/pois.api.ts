const BASE_URL = 'http://localhost:3000'; // TODO: replace with env config

export interface PoiWithDistance {
  id: string;
  name: string;
  city: string;
  description: string;
  distanceInMeters: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
  };
}

export async function fetchNearbyPois(
  lat: number,
  lng: number,
  page: number,
  radius = 5000,
  limit = 15,
): Promise<PaginatedResponse<PoiWithDistance>> {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lng: lng.toString(),
    radius: radius.toString(),
    page: page.toString(),
    limit: limit.toString(),
  });

  const res = await fetch(`${BASE_URL}/pois/nearby?${params}`);

  if (!res.ok) {
    throw new Error(`Failed to fetch nearby POIs: ${res.status}`);
  }

  return res.json();
}
