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
  },
];
