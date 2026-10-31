"use client";
import { useEffect, useRef, useState } from "react";
import { Search as SearchIcon, LoaderCircle, X, MapPin } from "lucide-react";
export type Place = {
  id: string;
  place_name: string;
  center: [number, number];
  bbox?: [number, number, number, number];
};
export default function Search({
  onSelect,
}: {
  onSelect: (place: Place) => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Place[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  const skip = useRef(false);
  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    if (query.trim().length < 2) {
      setResults([]);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      setError("");
      try {
        const url = new URL(
          `https://api.maptiler.com/geocoding/${encodeURIComponent(query.trim())}.json`,
        );
        url.search = new URLSearchParams({
          key: process.env.NEXT_PUBLIC_MAPTILER_KEY!,
          country: "gb",
          limit: "6",
          language: "en",
          autocomplete: "true",
        }).toString();
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error("Search unavailable. Please try again.");
        const data = await response.json();
        setResults(data.features || []);
        setActive(-1);
        if (!data.features?.length)
          setError("No UK locations found. Try a postcode or town.");
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  function choose(place: Place) {
    skip.current = true;
    setQuery(place.place_name.split(",")[0]);
    setResults([]);
    onSelect(place);
  }
  return (
    <div className="search-wrap">
      <div className="search-field">
        <SearchIcon size={19} />
        <input
          aria-label="Search UK locations"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="search-results"
          aria-activedescendant={active >= 0 ? `place-${active}` : undefined}
          value={query}
          placeholder="Search a road, town or postcode"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setResults([]);
              setError("");
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter" && results.length) {
              e.preventDefault();
              choose(results[Math.max(active, 0)]);
            }
          }}
        />
        {busy ? (
          <LoaderCircle size={17} className="spin" />
        ) : query ? (
          <button
            className="icon-button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setError("");
              setResults([]);
            }}
          >
            <X size={16} />
          </button>
        ) : (
          <kbd>UK</kbd>
        )}
      </div>
      {(results.length > 0 || error) && (
        <div className="search-results">
          <ul id="search-results" role="listbox">
            {results.map((place, i) => (
              <li
                key={place.id}
                id={`place-${i}`}
                role="option"
                aria-selected={i === active}
              >
                <button
                  className={i === active ? "active" : ""}
                  onClick={() => choose(place)}
                >
                  <MapPin size={17} />
                  <span>{place.place_name}</span>
                </button>
              </li>
            ))}
          </ul>
          {error && <p role="status">{error}</p>}
          <a
            href="https://www.maptiler.com/copyright/"
            target="_blank"
            rel="noreferrer"
          >
            Search © MapTiler
          </a>
        </div>
      )}
    </div>
  );
}
