import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

export async function checkRoads({
  root = "public/roads",
  base = process.env.NEXT_PUBLIC_ROADS_BASE_URL,
  fetcher = fetch,
} = {}) {
  let read;
  if (base) {
    const url = new URL(base);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error(
        "NEXT_PUBLIC_ROADS_BASE_URL must be a public HTTPS directory.",
      );
    base = url.href.replace(/\/$/, "");
    read = async (path) => {
      const response = await fetcher(`${base}/${path}`, {
        signal: AbortSignal.timeout(30_000),
        headers: { Origin: "https://swiftfix-road-check.invalid" },
      });
      if (!response.ok)
        throw Error(`Road CDN returned ${response.status} for ${path}`);
      // These assets must also be readable from a browser on the app's origin.
      if (response.headers.get("access-control-allow-origin") !== "*")
        throw Error(
          "Road CDN must return Access-Control-Allow-Origin: * for public road assets.",
        );
      return new Uint8Array(await response.arrayBuffer());
    };
  } else
    read = async (path) => new Uint8Array(await readFile(resolve(root, path)));
  const manifest = JSON.parse(
    new TextDecoder().decode(await read("manifest.json")),
  );
  if (
    manifest.format !== "swiftfix-road-cells" ||
    manifest.version !== 1 ||
    manifest.cellZoom !== 12 ||
    typeof manifest.dataset !== "string" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(manifest.dataset) ||
    !Array.isArray(manifest.cells) ||
    !manifest.cells.length ||
    !manifest.cells.every(
      (c) => typeof c === "string" && /^\d{1,4}\/\d{1,4}$/.test(c),
    )
  )
    throw Error("Invalid or empty road manifest.");
  // Local deployment: require every referenced file. CDN: probe a cell in all four UK nations.
  const locations = [
    [-0.164, 51.587],
    [-2.24, 53.48],
    [-4.25, 55.86],
    [-3.18, 51.48],
    [-5.93, 54.6],
  ];
  const samples = locations.map(
    ([lon, lat]) =>
      `${Math.floor(((lon + 180) / 360) * 4096)}/${Math.floor((0.5 - Math.log((1 + Math.sin((lat * Math.PI) / 180)) / (1 - Math.sin((lat * Math.PI) / 180))) / (4 * Math.PI)) * 4096)}`,
  );
  if (
    process.env.VERCEL &&
    samples.some((cell) => !manifest.cells.includes(cell))
  )
    throw Error(
      "The production road release must cover East Finchley, Manchester, Glasgow, Cardiff and Belfast.",
    );
  let bytes = 0;
  for (const cell of base
    ? [
        ...new Set([
          ...samples.filter((c) => manifest.cells.includes(c)),
          manifest.cells[0],
        ]),
      ]
    : manifest.cells) {
    const path = `${manifest.dataset}/12/${cell}.json.gz`;
    if (base) {
      const data = await read(path);
      const json = JSON.parse(
        new TextDecoder().decode(
          data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data,
        ),
      );
      if (json.type !== "FeatureCollection" || !Array.isArray(json.features))
        throw Error(`Invalid road cell: ${path}`);
    } else {
      const file = await stat(resolve(root, path));
      if (!file.isFile() || !file.size)
        throw Error(`Missing/empty road cell: ${path}`);
      bytes += file.size;
    }
  }
  return {
    dataset: manifest.dataset,
    cells: manifest.cells.length,
    localBytes: bytes,
    source: base || root,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.argv.includes("--vercel") || process.env.VERCEL) {
    try {
      console.log("Road deployment check:", await checkRoads());
    } catch (error) {
      console.error(
        "Road deployment blocked:",
        error.message,
        "\nGenerate the UK assets and deploy them in public/roads, or configure NEXT_PUBLIC_ROADS_BASE_URL. See docs/ROAD-DEPLOYMENT.md.",
      );
      process.exitCode = 1;
    }
  }
}
