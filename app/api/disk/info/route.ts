import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('OAuth ', '');
  
  if (!token) {
    return NextResponse.json({ error: 'No token provided' }, { status: 401 });
  }

  try {
    const response = await fetch('https://cloud-api.yandex.net/v1/disk', {
      headers: {
        'Authorization': `OAuth ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get disk info');
    }

    const diskInfo = await response.json();
    return NextResponse.json(diskInfo);
  } catch (error) {
    console.error('Disk info error:', error);
    return NextResponse.json({ error: 'Failed to get disk info' }, { status: 500 });
  }
}
