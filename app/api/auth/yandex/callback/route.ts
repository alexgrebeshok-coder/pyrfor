import { NextRequest, NextResponse } from 'next/server';

const YANDEX_CLIENT_ID = process.env.YANDEX_CLIENT_ID;
const YANDEX_CLIENT_SECRET = process.env.YANDEX_CLIENT_SECRET;
const REDIRECT_URI = process.env.YANDEX_REDIRECT_URI;

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  
  if (!code) {
    return NextResponse.redirect(new URL('/settings?error=no_code', request.url));
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth.yandex.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: YANDEX_CLIENT_ID || '',
        client_secret: YANDEX_CLIENT_SECRET || '',
        redirect_uri: REDIRECT_URI || '',
      }).toString(),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to get tokens');
    }

    const tokens = await tokenResponse.json();
    
    // TODO: Save tokens to database when Yandex integration is fully implemented.
    // Tokens are NOT forwarded to the client via URL params for security.
    
    const redirectUrl = new URL('/settings', request.url);
    redirectUrl.searchParams.set('yandex_connected', 'true');
    
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error('Yandex OAuth error:', error);
    return NextResponse.redirect(new URL('/settings?error=oauth_failed', request.url));
  }
}
