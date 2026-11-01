import type { Bounds, Road, View } from "./types";
import { emptyRoads } from "./types";
import { database } from "./indexed-db";
import { parseBackup } from "./backup";
import { roadData } from "./road-data";
export const api = {
  async view(bounds: Bounds, zoom: number): Promise<View> {
    const local = await database.view(bounds);
    try {
      return { ...local, roads: await roadData.load(bounds, zoom) };
    } catch (error) {
      return {
        ...local,
        roads: emptyRoads(),
        warning:
          error instanceof Error
            ? error.message
            : "Could not load road geometry.",
      };
    }
  },
  set: (road: Road, completed: boolean, expected?: string) =>
    database.set(road, completed, expected),
  exportBackup: () => database.exportBackup(),
  importBackup: (text: string) => {
    const { records, duplicates } = parseBackup(text);
    return database.importRecords(records, duplicates);
  },
  subscribe: (listener: () => void) => database.subscribe(listener),
};
