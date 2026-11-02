# Selectable UK road assets

Generate this directory's `manifest.json` and immutable release directory using `scripts/import_roads.py` as documented in the main README. Deploy both together. No example geometry is served in production, and the full UK dataset is not included in source control.

Generated geometry is © OpenStreetMap contributors, ODbL 1.0: https://www.openstreetmap.org/copyright

Licence text: https://opendatacommons.org/licenses/odbl/1-0/
This derived road dataset retains the OpenStreetMap attribution and ODbL licence. Source extract URL and SHA-256 are recorded in manifest.json.

The complete generated release may instead be served from a public static CDN using NEXT_PUBLIC_ROADS_BASE_URL. See docs/ROAD-DEPLOYMENT.md for publishing, CORS, sizing and deployment checks. Generated files remain separate from source control until their size is reviewed.
