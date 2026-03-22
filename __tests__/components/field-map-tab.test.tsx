import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/__tests__/utils/render";
import userEvent from "@testing-library/user-event";

import { FieldMapTab } from "@/components/field-operations/field-map-tab";

vi.mock("@/components/field-operations/field-map-canvas", () => ({
  FieldMapCanvas: () => <div data-testid="field-map-canvas" />,
  getFieldMapProvider: () => "yandex",
  getFieldMapProviderLabel: () => "Яндекс Карты",
}));

describe("FieldMapTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets the user focus the map on a selected marker", async () => {
    const user = userEvent.setup();

    render(
      <FieldMapTab
        markers={[
          {
            id: "project-moscow",
            kind: "project",
            label: "Москва",
            subtitle: "Центр",
            latitude: 55.7558,
            longitude: 37.6173,
            status: "live",
            count: 1,
            items: ["Проект Север"],
            observedAt: "2026-03-20T10:20:00.000Z",
            href: "/projects/project-moscow",
          },
          {
            id: "geofence-yamal",
            kind: "geofence",
            label: "Ямал",
            subtitle: "ЯНАО",
            latitude: 66.54,
            longitude: 66.6,
            status: "watch",
            count: 2,
            items: ["Зона 1", "Зона 2"],
            observedAt: "2026-03-20T10:25:00.000Z",
          },
        ]}
        unresolvedLocations={["Новая точка"]}
      />
    );

    expect(screen.getByText("Яндекс Карты")).toBeInTheDocument();
    expect(screen.getByTestId("field-map-canvas")).toBeInTheDocument();
    expect(screen.getByText("Новая точка")).toBeInTheDocument();

    const focusButtons = screen.getAllByRole("button", { name: "Показать на карте" });
    await user.click(focusButtons[0]);

    expect(screen.getByRole("button", { name: "В фокусе" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сбросить" })).toBeInTheDocument();
  });
});
