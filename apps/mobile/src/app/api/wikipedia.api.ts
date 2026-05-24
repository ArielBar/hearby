import axios from 'axios';

const BASE_URL = 'http://localhost:3000/api';

export interface WikipediaSummary {
  title: string;
  summary: string;
}

export async function fetchWikipediaSummary(
  lat: number,
  lng: number,
): Promise<WikipediaSummary | null> {
  try {
    const response = await axios.get<WikipediaSummary | null>(
      `${BASE_URL}/wikipedia/summary`,
      { params: { lat, lng } },
    );
    return response.data;
  } catch {
    return null;
  }
}
