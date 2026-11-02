import { RequestCache } from "./cache";
import { roadSource } from "./road-source";
import { intersects, roadBounds, validateRoad } from "./backup";
import { emptyRoads, type Bounds, type Roads } from "./types";

type Manifest = {
  format: "swiftfix-road-cells";
  version: 1;
  dataset: string;
  cellZoom: 12;
  cells: string[];
};
export function cellAt(lon: number, lat: number): [number, number] {
  const scale = 2 ** 12,
    sin = Math.sin((lat * Math.PI) / 180);
  return [
    Math.floor(((lon + 180) / 360) * scale),
    Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale),
  ];
}
export function visibleCells(bounds: Bounds): string[] {
  const [x0, y1] = cellAt(bounds[0], bounds[1]),
    [x1, y0] = cellAt(bounds[2], bounds[3]);
  const cells: string[] = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) cells.push(`${x}/${y}`);
  return cells;
}
export class StaticRoads {
  private manifest?: Promise<Manifest>;
  private cache = new RequestCache<Roads>(16, 10 * 60_000);
  constructor(
    private fetcher: typeof fetch = (...args) => fetch(...args),
    private source = roadSource(process.env.NEXT_PUBLIC_ROADS_BASE_URL),
  ) {}
  private getManifest() {
    if (!this.manifest)
      this.manifest = this.fetcher(`${this.source}/manifest.json`, {
        cache: "no-cache",
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(
              "Selectable UK road data is unavailable. Check the deployed road assets or road CDN configuration described in README. Saved highlights and backups remain available.",
            );
          const doc = (await response.json()) as Manifest;
          if (
            doc.format !== "swiftfix-road-cells" ||
            doc.version !== 1 ||
            doc.cellZoom !== 12 ||
            typeof doc.dataset !== "string" ||
            !/^[a-zA-Z0-9_-]{1,64}$/.test(doc.dataset) ||
            !Array.isArray(doc.cells) ||
            !doc.cells.every(
              (c) => typeof c === "string" && /^\d{1,4}\/\d{1,4}$/.test(c),
            )
          )
            throw new Error("Invalid road dataset manifest.");
          return doc;
        })
        .catch((error) => {
          this.manifest = undefined;
          throw error;
        });
    return this.manifest;
  }
  async load(bounds: Bounds, zoom: number): Promise<Roads> {
    if (zoom < 14) return emptyRoads();
    const cells = visibleCells(bounds);
    if (cells.length > 20)
      throw new Error("Zoom in further to select road sections.");
    const manifest = await this.getManifest(),
      available = new Set(manifest.cells);
    const requested = cells.filter((cell) => available.has(cell)),
      groups: Roads[] = [];
    for (let i = 0; i < requested.length; i += 4) {
      groups.push(
        ...(await Promise.all(
          requested.slice(i, i + 4).map((cell) =>
            this.cache.get(`${manifest.dataset}/${cell}`, async () => {
              const response = await this.fetcher(
                `${this.source}/${manifest.dataset}/12/${cell}.json.gz`,
              );
              if (!response.ok)
                throw new Error(
                  "Could not load road sections. Check your connection and retry.",
                );
              const bytes = new Uint8Array(await response.arrayBuffer());
              let text: string;
              if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
                if (typeof DecompressionStream === "undefined")
                  throw new Error(
                    "Update your browser to load compressed road geometry.",
                  );
                text = await new Response(
                  new Blob([bytes])
                    .stream()
                    .pipeThrough(new DecompressionStream("gzip")),
                ).text();
              } else text = new TextDecoder().decode(bytes);
              const data = JSON.parse(text);
              if (
                data.type !== "FeatureCollection" ||
                !Array.isArray(data.features)
              )
                throw new Error("Invalid road cell data.");
              return {
                type: "FeatureCollection",
                features: data.features.map(validateRoad),
              };
            }),
          ),
        )),
      );
    }
    const unique = new Map(
      groups
        .flatMap((g) => g.features)
        .filter((road) => intersects(roadBounds(road), bounds))
        .map((road) => [road.properties.id, road]),
    );
    if (unique.size > 12000)
      throw new Error("Too many road sections in view. Zoom in further.");
    return { type: "FeatureCollection", features: [...unique.values()] };
  }
}
export const roadData = new StaticRoads();
