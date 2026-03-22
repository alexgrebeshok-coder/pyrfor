import Link from "next/link";
import { Home, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <Card className="max-w-md w-full text-center border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-900/10">
        <CardContent className="p-8">
          <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-amber-500" />
          </div>
          
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Страница не найдена
          </h1>
          
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            Запрашиваемая страница не существует или была перемещена.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Link href="/">
              <Button className="gap-2">
                <Home className="w-4 h-4" />
                На главную
              </Button>
            </Link>
            <Link href="/search">
              <Button variant="outline" className="gap-2">
                <Search className="w-4 h-4" />
                К поиску
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
