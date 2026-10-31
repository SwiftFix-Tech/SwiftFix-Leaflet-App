import type { Feature, FeatureCollection, LineString } from "geojson";
export type RoadProps = {
  id: string;
  name: string;
  revision?: string;
  completed?: boolean;
};
export type Road = Feature<LineString, RoadProps>;
export type Roads = FeatureCollection<LineString, RoadProps>;
export const emptyRoads = (): Roads => ({
  type: "FeatureCollection",
  features: [],
});
export type Bounds = [number, number, number, number];
export type Mutation = {
  changed: boolean;
  revision: string;
  completed: boolean;
};
export type View = {
  roads: Roads;
  completed: Roads;
  count: number;
  revision: number;
};
