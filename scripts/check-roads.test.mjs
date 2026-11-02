import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRoads } from "./check-roads.mjs";

test("deployment rejects missing manifest or missing cells; accepts complete local release", async () => {
  const root = await mkdtemp(join(tmpdir(), "swiftfix-preflight-"));
  try {
    await assert.rejects(checkRoads({ root, base: "" }), /ENOENT/);
    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify({
        format: "swiftfix-road-cells",
        version: 1,
        cellZoom: 12,
        dataset: "test",
        cells: ["1/2"],
      }),
    );
    await assert.rejects(checkRoads({ root, base: "" }), /ENOENT/);
    await mkdir(join(root, "test/12/1"), { recursive: true });
    await writeFile(join(root, "test/12/1/2.json.gz"), "fixture");
    assert.equal((await checkRoads({ root, base: "" })).cells, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("CDN must serve public CORS assets and reject HTML error pages", async () => {
  const manifest = {
    format: "swiftfix-road-cells",
    version: 1,
    cellZoom: 12,
    dataset: "test",
    cells: ["1/2"],
  };
  const fetcher = async (url, options) => {
    assert.equal(options.headers.Origin, "https://swiftfix-road-check.invalid");
    return new Response(
      JSON.stringify(
        url.endsWith("manifest.json")
          ? manifest
          : { type: "FeatureCollection", features: [] },
      ),
      { headers: { "Access-Control-Allow-Origin": "*" } },
    );
  };
  assert.equal(
    (await checkRoads({ base: "https://roads.example/uk", fetcher })).cells,
    1,
  );
  await assert.rejects(
    checkRoads({
      base: "https://roads.example",
      fetcher: async () => new Response("{}"),
    }),
    /Allow-Origin/,
  );
  await assert.rejects(
    checkRoads({
      base: "https://roads.example",
      fetcher: async () =>
        new Response("<html>", {
          headers: { "Access-Control-Allow-Origin": "*" },
        }),
    }),
  );
  await assert.rejects(checkRoads({ base: "http://roads.example" }), /HTTPS/);
});
