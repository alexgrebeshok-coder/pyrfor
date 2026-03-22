import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('OAuth ', '');
  const path = request.nextUrl.searchParams.get('path');
  
  if (!token || !path) {
    return NextResponse.json({ error: 'Missing token or path' }, { status: 400 });
  }

  try {
    const response = await fetch(
      `https://cloud-api.yandex.net/v1/disk/resources/download?path=${encodeURIComponent(path)}`,
      {
        headers: {
          'Authorization': `OAuth ${token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to get download link');
    }

    const downloadLink = await response.json();
    return NextResponse.json(downloadLink);
  } catch (error) {
    console.error('Download link error:', error);
    return NextResponse.json({ error: 'Failed to get download link' }, { status: 500 });
  }
}
