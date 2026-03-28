import { MapContainer } from "@/components/map/map-container";
import { ErrorBoundary } from "@/components/error-boundary";

export default function MapPage() {
  return (
    <ErrorBoundary resetKey="map">
      <MapContainer />
    </ErrorBoundary>
  );
}
