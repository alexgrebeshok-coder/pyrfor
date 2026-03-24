"use client";

import { useState, useEffect, useRef } from "react";
import { Sidebar } from "./sidebar";
import { Minimap } from "./minimap";
import { StatusBar } from "./status-bar";
import { ObjectCard } from "./object-card";
import { XPProgress } from "./xp-progress";
import { AchievementPopup } from "./achievement-popup";
import type { Project, UserProfile } from "@/types/map";

interface MapContainerProps {
  projects?: Project[];
  user?: UserProfile;
}

// Sample data for demo
const SAMPLE_PROJECTS: Project[] = [
  {
    id: "1",
    name: "ЧЭМК",
    location: "Харп, ЯНАО",
    progress: 78,
    budget: 5200000,
    risks: 2,
    status: "warning",
    coordinates: [66.8844, 65.9541],
    description: "Переработка дунита",
  },
  {
    id: "2",
    name: "Бентонит",
    location: "Казахстан",
    progress: 45,
    budget: 3500000,
    risks: 0,
    status: "ok",
    coordinates: [50.4313, 80.2312],
    description: "Карьер бентонитовых глин",
  },
  {
    id: "3",
    name: "Ёлки",
    location: "Сургут",
    progress: 62,
    budget: 2800000,
    risks: 1,
    status: "warning",
    coordinates: [61.2540, 73.3962],
    description: "Детали уточняются",
  },
];

const DEFAULT_USER: UserProfile = {
  id: "user-1",
  name: "Александр",
  level: 5,
  xp: 340,
  maxXp: 500,
  achievements: 12,
};

interface YandexPlacemark {
  events: {
    add(event: "click", callback: () => void): void;
  };
}

interface YandexMap {
  geoObjects: {
    add(object: YandexPlacemark): void;
  };
}

interface YandexMapsApi {
  ready(callback: () => void): void;
  Map: new (
    target: string,
    options: {
      center: [number, number];
      zoom: number;
      controls: string[];
    }
  ) => YandexMap;
  Placemark: new (
    coordinates: [number, number],
    properties: {
      hintContent: string;
      balloonContent: string;
    }
  ) => YandexPlacemark;
}

export function MapContainer({
  projects: externalProjects,
  user = DEFAULT_USER,
}: MapContainerProps) {
  const [fetchedProjects, setFetchedProjects] = useState<Project[]>([]);
  const projects = externalProjects ?? (fetchedProjects.length > 0 ? fetchedProjects : SAMPLE_PROJECTS);
  const yandexWindow = typeof window === "undefined"
    ? null
    : (window as Window & { ymaps?: YandexMapsApi });
  const projectsRef = useRef(projects);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showAchievement, setShowAchievement] = useState(false);

  // Fetch real projects from API
  useEffect(() => {
    if (externalProjects) return;
    fetch("/api/map/projects")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.projects?.length > 0) setFetchedProjects(data.projects);
      })
      .catch(() => { /* use sample data as fallback */ });
  }, [externalProjects]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // Initialize map when Yandex API is ready
  useEffect(() => {
    if (typeof window === "undefined") return;

    const apiKey = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY;
    if (!apiKey) {
      setMapError("API ключ не настроен в .env");
      return;
    }

    const initMap = (ymaps: YandexMapsApi) => {
      try {
        const map = new ymaps.Map("yandex-map", {
          center: [61.2540, 73.3962],
          zoom: 4,
          controls: ["zoomControl", "typeSelector"],
        });

        // Add project markers
        projectsRef.current.forEach((project) => {
          const placemark = new ymaps.Placemark(
            project.coordinates,
            {
              hintContent: project.name,
              balloonContent: `
                <div style="padding: 10px;">
                  <strong>${project.name}</strong><br/>
                  <span style="color: #64748b;">${project.location}</span><br/>
                  <span style="color: ${getStatusColor(project.status)};">${project.progress}%</span>
                </div>
              `,
            }
          );

          placemark.events.add("click", () => {
            setSelectedProject(project);
          });

          map.geoObjects.add(placemark);
        });

        setMapLoaded(true);
        setMapError(null);
      } catch (error) {
        console.error("Failed to initialize map:", error);
        setMapError("Ошибка инициализации карты");
      }
    };

    // Check if Yandex Maps already loaded
    const ymaps = yandexWindow?.ymaps;
    if (ymaps) {
      initMap(ymaps);
      return;
    }

    // Check if script already exists
    const existingScript = document.querySelector('script[src*="api-maps.yandex.ru"]');
    if (existingScript) {
      existingScript.addEventListener("load", () => {
        const ymaps = yandexWindow?.ymaps;
        if (ymaps) {
          ymaps.ready(() => initMap(ymaps));
        }
      });
      return;
    }

    // Create and load script
    const script = document.createElement("script");
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${apiKey}&lang=ru_RU`;
    script.async = true;
    script.defer = true;
    
    script.onload = () => {
      const ymaps = yandexWindow?.ymaps;
      if (ymaps) {
        ymaps.ready(() => initMap(ymaps));
      }
    };

    script.onerror = () => {
      setMapError("Не удалось загрузить Yandex Maps API");
    };

    document.head.appendChild(script);

    return () => {
      // Cleanup if needed
    };
  }, [projectsRef, yandexWindow]);

  const handleProjectSelect = (project: Project) => {
    setSelectedProject(project);
  };

  const closeObjectCard = () => {
    setSelectedProject(null);
  };

  // Error state
  if (mapError) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-center p-8">
          <div className="text-6xl mb-4">🗺️</div>
          <h2 className="text-xl font-semibold text-red-400 mb-2">Ошибка загрузки карты</h2>
          <p className="text-slate-400 mb-4">{mapError}</p>
          {mapError.includes("API ключ") && (
            <p className="text-sm text-slate-500">
              Добавьте в .env:<br/>
              <code className="bg-slate-800 px-2 py-1 rounded mt-2 inline-block">
                NEXT_PUBLIC_YANDEX_MAPS_API_KEY=your_key
              </code>
            </p>
          )}
        </div>
      </div>
    );
  }

  // Loading state
  if (!mapLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-pulse">🗺️</div>
          <p className="text-lg text-slate-300">Загрузка карты...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-900">
      {/* Sidebar */}
      <div className="flex-shrink-0">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          projects={projects}
          onProjectSelect={handleProjectSelect}
          user={user}
        />
      </div>

      {/* Map Container */}
      <div className="flex-1 relative">
        <div
          id="yandex-map"
          style={{ width: "100%", height: "100%" }}
        />

        {/* Minimap (RTS-style) */}
        <div className="absolute right-4 bottom-20 z-20">
          <Minimap projects={projects} />
        </div>

        {/* Status Bar (RTS-style) */}
        <div className="absolute bottom-0 left-0 right-0 z-10">
          <StatusBar projects={projects} user={user} />
        </div>

        {/* XP Progress Bar */}
        <div className="absolute left-4 bottom-20 z-20">
          <XPProgress user={user} />
        </div>

        {/* Object Card Modal */}
        {selectedProject && (
          <ObjectCard project={selectedProject} onClose={closeObjectCard} />
        )}

        {/* Achievement Popup */}
        {showAchievement && (
          <AchievementPopup
            title="Задача выполнена!"
            xp={15}
            onClose={() => setShowAchievement(false)}
          />
        )}
      </div>
    </div>
  );
}

function getStatusColor(status: Project["status"]): string {
  switch (status) {
    case "critical":
      return "#ef4444";
    case "warning":
      return "#f59e0b";
    case "ok":
    default:
      return "#22c55e";
  }
}
