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
