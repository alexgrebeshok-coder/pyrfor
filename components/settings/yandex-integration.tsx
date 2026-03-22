"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HardDrive, Check, X, Loader2 } from 'lucide-react';

export function YandexIntegration() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [diskInfo, setDiskInfo] = useState<any>(null);

  useEffect(() => {
    // Check if Yandex is connected
    const token = localStorage.getItem('yandex_access_token');
    if (token) {
      setConnected(true);
      fetchDiskInfo(token);
    }
    
    // Check for OAuth callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('yandex_connected') === 'true') {
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const expiresIn = params.get('expires_in');
      
      if (accessToken && refreshToken) {
        localStorage.setItem('yandex_access_token', accessToken);
        localStorage.setItem('yandex_refresh_token', refreshToken);
        localStorage.setItem('yandex_expires_in', expiresIn || '31536000');
        setConnected(true);
        fetchDiskInfo(accessToken);
        
        // Clear URL params
        window.history.replaceState({}, '', '/settings');
      }
    }
  }, []);

  const fetchDiskInfo = async (token: string) => {
    setLoading(true);
    try {
      const response = await fetch('/api/disk/info', {
        headers: { 'Authorization': `OAuth ${token}` }
      });
      const data = await response.json();
      setDiskInfo(data);
    } catch (error) {
      console.error('Failed to fetch disk info:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = () => {
    window.location.href = '/api/auth/yandex';
  };

  const handleDisconnect = () => {
    localStorage.removeItem('yandex_access_token');
    localStorage.removeItem('yandex_refresh_token');
    localStorage.removeItem('yandex_expires_in');
    setConnected(false);
    setDiskInfo(null);
  };

  const formatBytes = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} ГБ`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-yellow-500" />
          Яндекс.Диск
        </CardTitle>
        <CardDescription>
          Подключите Яндекс.Диск для хранения файлов проекта
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <>
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Check className="h-4 w-4" />
              <span className="font-medium">Подключено</span>
            </div>
            
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка информации...
              </div>
            ) : diskInfo ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Использовано:</span>
                  <span>{formatBytes(diskInfo.used_space)} / {formatBytes(diskInfo.total_space)}</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full" 
                    style={{ width: `${(diskInfo.used_space / diskInfo.total_space) * 100}%` }}
                  />
                </div>
              </div>
            ) : null}
            
            <Button variant="outline" onClick={handleDisconnect} className="w-full">
              <X className="h-4 w-4 mr-2" />
              Отключить
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-muted-foreground">
              <X className="h-4 w-4" />
              <span>Не подключено</span>
            </div>
            
            <Button onClick={handleConnect} className="w-full">
              Подключить Яндекс.Диск
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
