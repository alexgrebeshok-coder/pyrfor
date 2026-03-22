import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('OAuth ', '');
  const path = request.nextUrl.searchParams.get('path');
  
  if (!token || !path) {
    return NextResponse.json({ error: 'Missing token or path' }, { status: 400 });
  }

  try {
    const response = await fetch(
      `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(path)}&overwrite=true`,
      {
        headers: {
          'Authorization': `OAuth ${token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to get upload link');
    }

    const uploadLink = await response.json();
    return NextResponse.json(uploadLink);
  } catch (error) {
    console.error('Upload link error:', error);
    return NextResponse.json({ error: 'Failed to get upload link' }, { status: 500 });
  }
}
