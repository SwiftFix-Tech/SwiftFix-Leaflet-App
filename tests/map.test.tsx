import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { road } from "./fixtures";
import { emptyRoads } from "../lib/types";
const mock = vi.hoisted(() => ({ current: null as any }));
vi.mock("maplibre-gl", () => {
  class Map {
    handlers: Record<string, Function[]> = {};
    sources: Record<string, any> = {};
    layers: Record<string, any> = {};
    canvas = document.createElement("canvas");
    z = 16;
    touchZoomRotate = { disableRotation: vi.fn() };
    constructor(options: any) {
      options.container.appendChild(this.canvas);
      mock.current = this;
    }
    on(e: string, fn: Function) {
      (this.handlers[e] ||= []).push(fn);
    }
    emit(e: string, data: any = {}) {
      this.handlers[e]?.forEach((fn) => fn(data));
    }
    addSource(id: string, data: any) {
      this.sources[id] = { ...data, setData: vi.fn() };
    }
    getSource(id: string) {
      return this.sources[id];
    }
    addLayer(data: any) {
      this.layers[data.id] = data;
    }
    getLayer(id: string) {
      return this.layers[id];
    }
    getStyle() {
      return { layers: [{ id: "labels", type: "symbol" }] };
    }
    getCanvas() {
      return this.canvas;
    }
    getBounds() {
      return {
        getWest: () => -0.17,
        getEast: () => -0.15,
        getSouth: () => 51.58,
        getNorth: () => 51.6,
      };
    }
    getZoom() {
      return this.z;
    }
    project(p: number[]) {
      return {
        x: (p[0] + 0.164) * 100000 + 50,
        y: (p[1] - 51.587) * 100000 + 50,
      };
    }
    queryRenderedFeatures() {
      return [{ properties: road.properties }];
    }
    remove() {}
    flyTo = vi.fn();
    fitBounds = vi.fn();
    zoomIn = vi.fn();
    zoomOut = vi.fn();
  }
  return { default: { Map } };
});
import RoadMap from "../components/RoadMap";
afterEach(cleanup);
function setup(completed = false) {
  const onMark = vi.fn(),
    onView = vi.fn();
  const view = render(
    <RoadMap
      roads={{ type: "FeatureCollection", features: [road] }}
      completed={
        completed
          ? { type: "FeatureCollection", features: [road] }
          : emptyRoads()
      }
      place={null}
      loading={false}
      onView={onView}
      onMark={onMark}
    />,
  );
  act(() => mock.current.emit("load"));
  return { ...view, onMark, onView };
}
describe("map event integration (mock renderer)", () => {
  it("left click selects complete source geometry", () => {
    const { onMark } = setup();
    act(() => mock.current.emit("click", { point: { x: 50, y: 50 } }));
    expect(onMark).toHaveBeenCalledWith(road, true);
  });
  it("right click exposes removal action and Escape dismisses it", () => {
    const { getByText, queryByText, onMark } = setup(true);
    const event = {
      point: { x: 50, y: 50 },
      preventDefault: vi.fn(),
      originalEvent: { preventDefault: vi.fn() },
    };
    act(() => mock.current.emit("contextmenu", event));
    expect(getByText("Completed")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(queryByText("Remove Highlight")).toBeNull();
    act(() => mock.current.emit("contextmenu", event));
    fireEvent.click(getByText("Remove Highlight"));
    expect(onMark).toHaveBeenCalledWith(road, false);
  });
  it("click elsewhere closes menu and street zoom gates selection", () => {
    const { queryByText } = setup(true);
    act(() =>
      mock.current.emit("contextmenu", {
        point: { x: 50, y: 50 },
        preventDefault: vi.fn(),
        originalEvent: { preventDefault: vi.fn() },
      }),
    );
    fireEvent.pointerDown(document.body);
    expect(queryByText("Remove Highlight")).toBeNull();
    mock.current.z = 10;
    const { onMark } = setup();
    mock.current.z = 10;
    act(() => mock.current.emit("click", { point: { x: 50, y: 50 } }));
    expect(onMark).not.toHaveBeenCalled();
  });
  it("highlight uses geographic source coordinates and blue style below labels at every zoom", () => {
    setup(true);
    expect(mock.current.sources.completed.data.features[0].geometry).toEqual(
      road.geometry,
    );
    expect(mock.current.layers["completed-line"].paint["line-color"]).toBe(
      "#1683FF",
    );
    mock.current.z = 18;
    act(() => mock.current.emit("moveend"));
    expect(mock.current.sources.completed.data.features[0].geometry).toEqual(
      road.geometry,
    );
  });
  it("mobile long press opens removal and its generated click preserves the menu", () => {
    vi.useFakeTimers();
    const { getByText, onMark } = setup(true);
    const event = new Event("pointerdown");
    Object.assign(event, {
      pointerType: "touch",
      isPrimary: true,
      clientX: 50,
      clientY: 50,
    });
    act(() => {
      mock.current.canvas.dispatchEvent(event);
      vi.advanceTimersByTime(550);
    });
    expect(getByText("Remove Highlight")).toBeTruthy();
    act(() => mock.current.emit("click", { point: { x: 50, y: 50 } }));
    expect(getByText("Remove Highlight")).toBeTruthy();
    expect(onMark).not.toHaveBeenCalled();
    fireEvent.click(getByText("Remove Highlight"));
    expect(onMark).toHaveBeenCalledWith(road, false);
    vi.useRealTimers();
  });
});
