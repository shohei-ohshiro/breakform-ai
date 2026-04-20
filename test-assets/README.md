# Test Assets

BreakForm AI の各技テスト検証用素材。

## Directory Structure

```
test-assets/
  middle_split/          180度開脚
    *.svg                  SVG スティックフィギュア画像（ビジュアル確認用）
    _fixtures/*.json       JSON ランドマーク（パイプライン投入用）
    README.md              シナリオ一覧

  handstand/             倒立
    _fixtures/             (TODO)

  planche/               プランシェ
    _fixtures/             (TODO)

  swipes/                スワイプス
    _fixtures/             (TODO)
```

## Re-generate

```bash
node test-assets/generate-middle-split.mjs
```

## JSON Fixture Format

```json
{
  "_comment": "硬い人 (90°) — 開脚初心者",
  "_generator": "generate-middle-split.mjs",
  "params": { "splitAngleDeg": 90 },
  "landmarks": [
    { "x": 0.5, "y": 0.5, "z": 0, "visibility": 0.9 },
    ...  // 33 landmarks (MediaPipe Pose)
  ]
}
```

## Usage in Tests

```typescript
import fixture from "../../test-assets/middle_split/_fixtures/average_130deg.json";
import { makeImageSeries } from "./mock-data";
import { normalizePoseTimeSeries } from "@/lib/analysis/pose-normalizer";
import { extractFeatures } from "@/lib/analysis/feature-extractor";
import { evaluate } from "@/lib/analysis/evaluators";

const series = makeImageSeries(fixture.landmarks);
const normalized = normalizePoseTimeSeries(series);
const features = extractFeatures(normalized, "middle_split");
const evaluation = evaluate("middle_split", normalized, features);
```

## SVG Preview

Open any `.svg` file in a browser. Visual legend:
- Blue lines: left leg (hip -> knee -> ankle)
- Green lines: right leg
- Gray lines: trunk, arms
- Purple dots: hip joints
- Orange dots: ankle joints
- Coloured arc: split angle
  - Green >= 170 / Yellow >= 150 / Orange >= 120 / Red < 120
