import { NextResponse } from 'next/server';

const YANDEX_CLIENT_ID = process.env.YANDEX_CLIENT_ID;
const REDIRECT_URI = process.env.YANDEX_REDIRECT_URI;

export async function GET() {
  const authUrl = new URL('https://oauth.yandex.com/authorize');
  
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', YANDEX_CLIENT_ID || '');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI || '');
  authUrl.searchParams.set('scope', 'cloud_api:disk.app_folder cloud_api:disk.info login:info login:email');
  
  return NextResponse.redirect(authUrl.toString());
}
