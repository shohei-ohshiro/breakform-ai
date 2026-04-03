import Link from "next/link";
import {
  Zap,
  Target,
  TrendingUp,
  Shield,
  Video,
  Brain,
  ChevronRight,
} from "lucide-react";
import { TRICKS } from "@/lib/tricks/data";
import { TRICK_CATEGORY_LABELS, TrickCategory } from "@/lib/types";

export default function Home() {
  const tricksByCategory = TRICKS.reduce(
    (acc, trick) => {
      if (!acc[trick.category]) acc[trick.category] = [];
      acc[trick.category].push(trick);
      return acc;
    },
    {} as Record<string, typeof TRICKS>
  );

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 via-transparent to-blue-500/10" />

        <nav className="relative z-10 max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-7 h-7 text-green-400" />
            <span className="text-xl font-bold">BreakForm AI</span>
          </div>
          <Link
            href="/analyze"
            className="px-5 py-2.5 bg-green-500 hover:bg-green-400 text-black font-semibold rounded-lg transition-colors"
          >
            無料で試す
          </Link>
        </nav>

        <div className="relative z-10 max-w-4xl mx-auto px-4 py-20 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full text-green-400 text-sm mb-6">
            <Zap className="w-4 h-4" />
            世界初のブレイクダンス特化AI分析
          </div>

          <h1 className="text-5xl md:text-6xl font-bold leading-tight">
            あなたの技を
            <br />
            <span className="text-green-400">AIが分析</span>する
          </h1>

          <p className="mt-6 text-xl text-gray-400 max-w-2xl mx-auto">
            動画をアップロードするだけ。AIが骨格を検出し、フォームの問題点を特定。
            具体的な筋トレ・ストレッチ・怪我予防のアドバイスを提供します。
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/analyze"
              className="flex items-center gap-2 px-8 py-4 bg-green-500 hover:bg-green-400 text-black font-bold text-lg rounded-xl transition-colors"
            >
              フォームを分析する
              <ChevronRight className="w-5 h-5" />
            </Link>
            <p className="text-sm text-gray-500">
              月3回まで無料 / 登録不要で体験可能
            </p>
          </div>
        </div>
      </header>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-center mb-12">
          BreakForm AIの特徴
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              icon: Video,
              title: "動画・写真分析",
              description:
                "動画や写真をアップロードするだけ。ブラウザ内で骨格検出を行うため、画像がサーバーに送信されることはありません。",
              color: "text-blue-400",
              bg: "bg-blue-500/10",
            },
            {
              icon: Brain,
              title: "AI専門コーチング",
              description:
                "スコアだけでなく、具体的な筋トレメニュー（種目・レップ数・頻度）、ストレッチ、ウォームアップを提案します。",
              color: "text-green-400",
              bg: "bg-green-500/10",
            },
            {
              icon: Shield,
              title: "怪我予防アドバイス",
              description:
                "危険なフォームを検出し、インナーマッスルの強化やウォームアップなど、怪我を防ぐための具体的な対策を提示します。",
              color: "text-red-400",
              bg: "bg-red-500/10",
            },
            {
              icon: Target,
              title: "骨格 & 重心分析",
              description:
                "33の身体ランドマークを検出し、関節角度と重心位置を計算。理想のフォームとのずれを数値で可視化します。",
              color: "text-yellow-400",
              bg: "bg-yellow-500/10",
            },
            {
              icon: TrendingUp,
              title: "段階的上達サポート",
              description:
                "現在のレベルに基づいた段階的なトレーニングプランを生成。無理なく安全にスキルアップできます。（近日公開）",
              color: "text-purple-400",
              bg: "bg-purple-500/10",
            },
            {
              icon: Zap,
              title: "ブラウザで完結",
              description:
                "アプリのダウンロード不要。スマホでもPCでも、ブラウザを開くだけですぐに使えます。",
              color: "text-cyan-400",
              bg: "bg-cyan-500/10",
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="p-6 bg-gray-900/50 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors"
            >
              <div
                className={`inline-flex p-3 rounded-lg ${feature.bg} mb-4`}
              >
                <feature.icon className={`w-6 h-6 ${feature.color}`} />
              </div>
              <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-gray-400">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Supported Tricks */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-center mb-4">
          対応している技
        </h2>
        <p className="text-center text-gray-400 mb-12">
          Phase 1では以下の10技に対応。今後順次追加予定です。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(tricksByCategory).map(([category, tricks]) => (
            <div
              key={category}
              className="p-5 bg-gray-900/50 border border-gray-800 rounded-xl"
            >
              <h3 className="text-sm font-semibold text-green-400 mb-3">
                {TRICK_CATEGORY_LABELS[category as TrickCategory]}
              </h3>
              <div className="space-y-2">
                {tricks.map((trick) => (
                  <div
                    key={trick.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-300">{trick.name_ja}</span>
                    <div className="flex gap-0.5">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <div
                          key={i}
                          className={`w-1.5 h-3 rounded-sm ${
                            i < trick.difficulty
                              ? "bg-green-500"
                              : "bg-gray-800"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-3xl font-bold mb-4">
          今すぐフォームをチェックしよう
        </h2>
        <p className="text-gray-400 mb-8">
          登録不要で月3回まで無料。あなたの技をAIが分析します。
        </p>
        <Link
          href="/analyze"
          className="inline-flex items-center gap-2 px-8 py-4 bg-green-500 hover:bg-green-400 text-black font-bold text-lg rounded-xl transition-colors"
        >
          分析を始める
          <ChevronRight className="w-5 h-5" />
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-8">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-green-500" />
            <span>BreakForm AI</span>
          </div>
          <p>&copy; 2026 BreakForm AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
