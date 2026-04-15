import { Trick } from "@/lib/types";

export const TRICKS: Trick[] = [
  {
    id: "handstand",
    name: "Handstand",
    name_ja: "倒立（ハンドスタンド）",
    category: "acrobatics",
    difficulty: 4,
    description: "A balanced inverted position supported by both hands",
    description_ja:
      "両手で体を支え、逆さまの状態でバランスを取るポーズ。体幹と肩の安定性が重要。",
    captureGuidance_ja:
      "真横から全身が映るように撮影してください。倒立の静止保持が2秒以上ある動画が理想です。",
  },
  {
    id: "planche",
    name: "Planche",
    name_ja: "プランシェ",
    category: "acrobatics",
    difficulty: 9,
    description:
      "A horizontal body hold supported only by the hands with feet off the ground",
    description_ja:
      "両手のみで体を水平に浮かせるポーズ。肩、前腕、体幹の極めて高い筋力が必要。",
    captureGuidance_ja:
      "真横から全身（手〜つま先）が映るように撮影してください。進入〜保持まで含んだ動画だと精度が上がります。",
  },
  {
    id: "swipes",
    name: "Swipes",
    name_ja: "スワイプス",
    category: "power_move",
    difficulty: 5,
    description:
      "A rotational move where the body spins horizontally using hands and feet",
    description_ja:
      "手と足で交互に支えながら水平に回転する技。タイミングと腰の回転が重要。動画での分析推奨。",
    captureGuidance_ja:
      "少し引いたアングルから全身が常に映るように動画で撮影してください。連続2サイクル以上あると分析精度が向上します。",
  },
  {
    id: "middle_split",
    name: "Middle Split",
    name_ja: "横開脚（180度開脚）",
    category: "flexibility",
    difficulty: 6,
    description:
      "A seated straddle split with legs extended sideways toward 180°",
    description_ja:
      "床に座り両脚を左右に開く横開脚。180度に近づけるために、骨盤・股関節・脚ラインのバランスを見ます。正面から撮影した静止画でMVP分析に対応。",
    captureGuidance_ja:
      "真正面（つま先側）から撮影し、骨盤〜足先までが全て画面に収まるようにしてください。静止画（写真）でOKです。体の前傾は避け、背筋を伸ばした状態で撮影すると正確に計測できます。タイトめの服装だと骨格検出がより安定します。",
  },
];
