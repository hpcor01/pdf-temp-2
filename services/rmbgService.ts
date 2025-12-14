const API_URL = import.meta.env.VITE_RMBG_API_URL;

export async function removeBackground(imageBase64: string): Promise<string> {
  if (!API_URL) {
    throw new Error('VITE_RMBG_API_URL not defined');
  }

  try {
    const res = await fetchWithTimeout(
      `${API_URL}/remove-bg`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64 }),
      },
      30000
    );

    if (!res.ok) {
      throw new Error(`RMBG failed: ${res.status}`);
    }

    const data = await res.json();
    if (!data?.image) {
      throw new Error('Invalid RMBG response');
    }

    return data.image;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('RMBG timeout (cold start)');
    }
    throw err;
  }
}
