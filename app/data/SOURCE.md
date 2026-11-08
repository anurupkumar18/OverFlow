# Catalog provenance

The normalized `catalog.json` contains **470 real scheduled items** from the [official KubeCon + CloudNativeCon North America 2026 schedule](https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/program/schedule/). Its `data-sched-config` names the [public Sessionize API](https://sessionize.com/api/v2/svi82w6c/view/All); the [CNCF End User Community](https://endusers.cncf.io/events/2026/kubecon-na/) independently links that API.

Snapshot retrieval time and SHA-256 of the fetched response are in `catalog.json.source`. This is the retrieval time, **not** a provider update timestamp. The schedule is changeable; session links lead to the authoritative current listing.

Selection: 600 schedule entries fetched; 480 have speakers, abstract, room and times; exclude 10 posters that intentionally run concurrently in the same hall. Remaining 470 have unique IDs and no overlapping intervals in the same room. This includes main talks, maintainer and lightning talks, theater programming and some scheduled experiences. It is not a count of main-conference breakout talks.

The official page says MST (UTC−7). API times are naive local values; ingest attaches `America/Denver` and produces UTC `Z`. Floors come directly from room names, including Hyatt Levels 4 and 5.

**Capacities are uniformly 200-person planning estimates for demonstration.** They are not measured venue capacities. `capacity_source: estimate` appears on every record. The catalog contains no attendance, room-fullness observations, bookmarks, participant relevance judgments or evaluation scores. `synthetic:false` identifies actual published schedule metadata; it does not turn the capacity estimate into fact.

Rebuild from repo root with Python 3.11+ and standard-library timezone data:

```sh
python3 -m scripts.ingest.catalog --output app/data/catalog.json
python3 -m scripts.ingest.catalog --validate app/data/catalog.json
python3 -m unittest discover -s scripts/tests -v
```

The network call is bounded to 30 seconds and 10 MB. `--input /absolute/path/sessionize.json` supports offline input; only normalized JSON is written. Do not commit raw schedule pages or raw speaker biographies. Full source changes may legitimately change the count on future refreshes; current docs must be updated with a new snapshot.

## CNCF landscape project mentions

Original Sessionize tags include both the official **CNCF Projects** category and **SubTopic** labels; they were not a complete landscape-derived mention index. All original tags are preserved.

Additional tags now derive from the [official CNCF landscape projects API](https://landscape.cncf.io/api/projects/all.json), retrieved **2026-11-08T22:39:43.904317Z**, SHA-256 **e56a04ccda7146dd4e7c9f6985dc88aca2161292eee035701ccfe714c535cdce**. This is an observed download time, not a provider update timestamp. The [official API implementation/schema](https://github.com/cncf/landscape2/blob/main/crates/cli/src/build/api.rs) declares `projects/all.json`, selects project entries by maturity, and provides `id`, `name`, maturity and open-source metadata. We use this supported API rather than the large generated full landscape or vendor/member lists. No logos, Crunchbase/funding data or vendor descriptions are copied into the catalog.

Of 259 source project records, 167 satisfy the conservative matching policy: active graduated/incubating/sandbox projects with explicit open-source status, names at least five characters long, and no explicit ordinary-word ambiguity. The importer finds case-insensitive **exact whole official names** in each talk's title or abstract, prioritizes title mentions, then appends at most six derived mentions per talk. No alias expansion, acronym expansion, fuzzy matches, vendor tags or inferred landscape categories are used. Short names such as Argo, Flux, Helm, KEDA and gRPC, and common names such as Harbor, Radius, Score, Envoy and Backstage, are deliberately omitted from *derived* matches; existing official schedule tags still survive.

Each talk's `derived_project_mentions` records the canonical name, official project ID, project-record URL, matched title/abstract fields, `method: derived_exact_whole_name_mention`, and whether the name was newly added to `tags`. These are textual mentions, **not participant relevance labels, affiliation, endorsement or proof that a talk teaches the project**. Missing matches do not prove a project is absent: naming variants, archived projects, specifications without explicit OSS status, ambiguity exclusions and the six-mention cap can omit relevant names. The snapshot has 520 traced mentions across 363 sessions, including names already present as official tags; **456 newly appended tags**. All 470 base records, original tags, timestamps and capacity estimates were checked unchanged.

`catalog.json.source.landscape` records source/hash, retrieval time, policy, exclusions and measured counts. Repeating enrichment with identical cached data preserves its recorded timestamp and produces byte-identical output:

```sh
python3 -m scripts.ingest.catalog --enrich-catalog app/data/catalog.json --landscape-input /absolute/path/projects-all.json --output app/data/catalog.json
```

To enrich an existing snapshot from the current public API, omit `--landscape-input`. Network reads are bounded to 30 seconds and 5 MB. The default live schedule refresh also fetches project data. Offline `--input` stays offline; supply `--landscape-input` to include cached project data as well. `--landscape-retrieved-at` and `--schedule-retrieved-at` accept recorded UTC timestamps for exact offline replay. `--skip-landscape` explicitly skips new enrichment. Missing/malformed project input is rejected; a failed live landscape fetch during a new schedule refresh is explicitly marked `unavailable` with no derived additions. Failure while enriching an existing snapshot leaves its file intact. Raw landscape input stays outside the repository.

Validation covered exact-name matching, substring/ambiguous/short/vendor/archived exclusions, original-tag preservation, provenance/hash, no input mutation, six-mention cap, missing/malformed input and deterministic repeat. Actual existing-snapshot CLI replay was byte-identical, and all 470 talks passed duplicate/UTC/overlap validation afterward. The complete Python suite passed 50/50 tests on November 8 after enrichment.
