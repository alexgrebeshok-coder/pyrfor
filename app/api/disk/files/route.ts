import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('OAuth ', '');
  const path = request.nextUrl.searchParams.get('path') || '/';
  
  if (!token) {
    return NextResponse.json({ error: 'No token provided' }, { status: 401 });
  }

  try {
    const response = await fetch(
      `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(path)}&limit=100`,
      {
        headers: {
          'Authorization': `OAuth ${token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to list files');
    }

    const fileList = await response.json();
    return NextResponse.json(fileList);
  } catch (error) {
    console.error('Disk files error:', error);
    return NextResponse.json({ error: 'Failed to list files' }, { status: 500 });
  }
}
