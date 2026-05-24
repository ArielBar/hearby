import axios from 'axios';

const BASE_URL = 'http://localhost:3000/api';

export interface WikipediaSummary {
  title: string;
  summary: string;
  url: string;
}

export async function fetchWikipediaSummary(
  name: string,
): Promise<WikipediaSummary | null> {
  try {
    const response = await axios.get<WikipediaSummary | null>(
      `${BASE_URL}/wikipedia/summary`,
      { params: { name } },
    );
    return response.data;
  } catch {
    return null;
  }
}
