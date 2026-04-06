# BreakForm AI - デプロイ & 動作確認ガイド

## 1. 環境構成

### 必要な環境変数

| 変数名 | 必須 | 設定場所 | 用途 |
|--------|------|----------|------|
| `ANTHROPIC_API_KEY` | Yes | Vercel / .env.local | Claude APIによるアドバイス生成 |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Vercel / .env.local | Supabase接続 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Vercel / .env.local | Supabase匿名認証 |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Vercel / .env.local | サーバーサイドDB操作（未ログインでも動作） |

### ローカル vs 本番の差異

| 項目 | ローカル | 本番 (Vercel) |
|------|---------|---------------|
| URL | http://localhost:3000 | https://breakform-ai.vercel.app |
| 環境変数 | `.env.local` | Vercel Dashboard > Settings > Environment Variables |
| DB | 同じSupabase | 同じSupabase |
| MediaPipe | ブラウザ側で実行 | ブラウザ側で実行（同じ） |
| Claude API | サーバーサイド | サーバーサイド |

## 2. ローカル開発

```bash
# Node.js 18+ が必要
nvm use 20

# 依存インストール
npm install

# .env.local を設定（.env.example を参照）
cp .env.example .env.local
# → 各キーを記入

# 開発サーバー起動
npm run dev
# → http://localhost:3000/analyze
```

## 3. デプロイ

### Vercel（自動デプロイ）

mainブランチへpushすると自動デプロイされる。

```bash
git push origin main
```

### 環境変数の設定（初回のみ）

1. Vercel Dashboard > Project > Settings > Environment Variables
2. 以下を追加:
   - `ANTHROPIC_API_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`（任意）

### Supabase DBマイグレーション

新しい分析パイプラインのカラムを追加する必要がある:

1. Supabase Dashboard > SQL Editor
2. `supabase/migrations/002_add_analysis_details.sql` の内容を実行
3. 追加されるカラム: `feature_json`, `event_json`, `rule_result_json`, `viewpoint`, `quality_check_result`, `final_score`

## 4. スマホ実機確認手順

### アクセス方法

1. スマホブラウザで `https://breakform-ai.vercel.app/analyze` を開く
2. ログイン不要（月3回まで無料）

### 動作確認フロー

1. 「ファイルを選択」から動画/写真をアップロード
2. 技を選択（倒立 / プランシェ / スワイプス）
3. 「分析開始」をタップ
4. 骨格検出 → AI分析 → 結果表示

## 5. デバッグモード

### 有効にする方法

URLに `?debug=true` を追加:

```
https://breakform-ai.vercel.app/analyze?debug=true
```

### デバッグモードで追加表示される項目

- **紫のバナー**: デバッグモードONの表示
- **quality_check_result**: 入力データの品質評価
- **rule_result_json**: ルールベース評価の全詳細（スコア内訳、violations、events）
- **feature_json**: 抽出された特徴量（関節角度、重心、速度）
- **event_json**: 検出されたイベント（swipesのみ：hand_plant, leg_swing等）

### 通常モードでも見える項目

- スコア内訳バー（breakdown）
- 品質に関する注意（quality warnings）
- 「詳細分析データ」トグル → violation詳細

## 6. 動画確認チェックリスト

### 対象技: 倒立（Handstand）

| 項目 | 内容 |
|------|------|
| **推奨撮影条件** | 横向き（サイドビュー）、全身が映る、明るい場所 |
| **成功しやすい条件** | 静止画 or 短い動画（5秒以内）、壁なし、背景シンプル |
| **quality warning が出やすい条件** | 暗い場所、人物が小さい、手足が画面外、複数人映り込み |
| **見るべき結果項目** | 体幹の直線性スコア、肩の角度、腰のアライメント |
| **debug確認項目** | `spineAngle`, `shoulderAlignment`, `hipAlignment` in feature_json |

### 対象技: プランシェ（Planche）

| 項目 | 内容 |
|------|------|
| **推奨撮影条件** | 横向き（サイドビュー）、全身が映る |
| **成功しやすい条件** | 静止画推奨、体が水平に近い状態 |
| **quality warning が出やすい条件** | 上から撮影、手が隠れている |
| **見るべき結果項目** | 水平度スコア、肩の前傾角度、腕の伸展 |
| **debug確認項目** | `leftShoulder`, `rightShoulder`, `spineAngle` in feature_json |

### 対象技: スワイプス（Swipes）

| 項目 | 内容 |
|------|------|
| **推奨撮影条件** | 正面 or やや斜め、全身が映る、動画必須 |
| **成功しやすい条件** | 動画（3〜10秒）、1〜3回転、10fps以上で撮影 |
| **quality warning が出やすい条件** | フレーム数不足、動きが速すぎてブレる、画面外に出る |
| **見るべき結果項目** | 回転の検出数、手足の入れ替えタイミング |
| **debug確認項目** | `event_json` の hand_plant / leg_swing イベント、phase検出 |

## 7. ログ/JSONの見方

### quality_check_result

分析に十分な品質のデータかを評価。

```json
{
  "passed": true/false,           // 品質チェック通過？
  "overallScore": 0.85,           // 0-1 の品質スコア
  "warnings": ["..."],            // UIに表示される警告
  "details": {
    "avgVisibility": 0.9,         // 平均visibility（0.5未満は問題）
    "lowVisibilityFrames": 2,     // visibility低いフレーム数
    "subjectSize": 0.3,           // 被写体サイズ（0.1未満は小さすぎ）
    "sufficientFrames": true      // フレーム数は十分か
  },
  "retryRecommended": false       // 撮り直し推奨？
}
```

**判断基準**: `passed: false` + `retryRecommended: true` → 撮影し直す

### rule_result_json

ルールベース評価の全結果。スコアの根拠。

```json
{
  "technique": "handstand",
  "finalScore": 72,
  "breakdown": [
    {
      "category": "alignment",
      "label": "体幹の直線性",
      "score": 80,
      "weight": 0.35,
      "violations": [
        {
          "ruleId": "spine_angle",
          "severity": "major",       // critical > major > minor
          "message": "体幹が前傾しています",
          "actual": 15.3,            // 実測値
          "ideal": 0,                // 理想値
          "threshold": { "warn": 10, "fail": 20 },
          "scoreImpact": 8.5         // スコアへの影響（pt）
        }
      ]
    }
  ]
}
```

**判断基準**: `scoreImpact` が大きい violation = スコアに最も影響している問題

### feature_json

抽出された特徴量。再分析やデバッグに使用。

```json
{
  "angles": [{ "timestamp": 0, "spineAngle": 5.2, "leftShoulder": 170, ... }],
  "cog": [{ "timestamp": 0, "x": 0.5, "y": 0.3 }],
  "velocities": { "27": [{ "speed": 0.02, ... }] },  // landmark index -> velocities
  "staticIntervals": [{ "startTime": 0.5, "endTime": 2.0, "avgMovement": 0.01 }]
}
```

**判断基準**: `staticIntervals` が空 → 静止ポーズが検出できていない（動画の場合）

### event_json（swipesのみ）

検出されたイベント時系列。

```json
[
  { "type": "hand_plant", "timestamp": 0.5, "frameIndex": 5, "details": { "hand": "left" } },
  { "type": "leg_swing", "timestamp": 0.8, "frameIndex": 8, "details": { "speed": 2.1 } }
]
```

**判断基準**: swipesで `hand_plant` が0件 → 手つきが検出できていない

## 8. フィードバック報告フォーマット

精度改善のためフィードバックを返す際、以下の形式だと原因追跡しやすい:

```
## 技: [倒立 / プランシェ / スワイプス]
## 撮影条件: [横から / 正面から / 斜めから], [静止画 / 動画 X秒]
## 期待した結果: [例: スコア70以上、体幹の問題を指摘してほしい]
## 実際の結果: [例: スコア30、quality warningが出た]
## debug=true での確認:
- quality_check_result.passed: [true/false]
- quality_check_result.warnings: [内容]
- 最も scoreImpact が大きい violation: [ruleId, message, actual/ideal]
- event_json のイベント数（swipesの場合）: [N件]
## スクリーンショット: [あれば]
```
