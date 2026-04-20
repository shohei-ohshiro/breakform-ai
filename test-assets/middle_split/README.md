# Middle Split Test Assets

Auto-generated stick-figure images + JSON landmark fixtures.
Re-generate: `node test-assets/generate-middle-split.mjs`

## Scenarios

| File | Split Angle | Description |
|------|-------------|-------------|
| stiff_90deg | 90° | 開脚初心者 — 膝がやや開く程度 |
| stiff_110deg | 110° | 週1ストレッチ程度の柔軟性 |
| average_130deg | 130° | 定期的にストレッチしている人 |
| average_150deg | 150° | 柔軟性が高いが180°には届かない |
| flexible_170deg | 170° | ほぼフルスプリット寸前 |
| full_split_178deg | 178° | ほぼ完璧な180度開脚 |
| stiff_with_knee_bend | 110° | 膝を曲げて代償するパターン |
| average_with_pelvis_roll | 140° | 骨盤が左右に12°傾いている |
| average_with_trunk_lean | 140° | 上半身が右に20°傾いている |
| average_asymmetric | 140° | 右脚が15°高く上がっている（非対称） |
| flexible_with_forward_lean | 165° | 体幹が前に15°傾いて代償 |
| stiff_all_issues | 100° | 膝曲がり + 骨盤傾き + 左右差 + 体幹傾き |

## Usage in tests

```typescript
import fixture from "../../test-assets/middle_split/_fixtures/average_130deg.json";
const series = makeImageSeries(fixture.landmarks);
const normalized = normalizePoseTimeSeries(series);
const features = extractFeatures(normalized, "middle_split");
```

## SVG images

Open any `.svg` file in a browser. The stick figure shows:
- Blue lines: left leg (hip -> knee -> ankle)
- Green lines: right leg
- Purple dots: hip joints
- Orange dots: ankle joints
- Coloured arc: split angle (green >= 170, yellow >= 150, orange >= 120, red < 120)
