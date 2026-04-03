"use client";

import { TRICKS } from "@/lib/tricks/data";
import { Trick, TRICK_CATEGORY_LABELS } from "@/lib/types";

interface TrickSelectorProps {
  selectedTrickId: string | null;
  onSelect: (trick: Trick) => void;
}

export default function TrickSelector({
  selectedTrickId,
  onSelect,
}: TrickSelectorProps) {
  // Group tricks by category
  const grouped = TRICKS.reduce(
    (acc, trick) => {
      if (!acc[trick.category]) acc[trick.category] = [];
      acc[trick.category].push(trick);
      return acc;
    },
    {} as Record<string, Trick[]>
  );

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-gray-300 mb-2">
        分析する技を選択
      </label>
      <select
        value={selectedTrickId || ""}
        onChange={(e) => {
          const trick = TRICKS.find((t) => t.id === e.target.value);
          if (trick) onSelect(trick);
        }}
        className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
      >
        <option value="" disabled>
          -- 技を選択してください --
        </option>
        {Object.entries(grouped).map(([category, tricks]) => (
          <optgroup
            key={category}
            label={
              TRICK_CATEGORY_LABELS[
                category as keyof typeof TRICK_CATEGORY_LABELS
              ]
            }
          >
            {tricks.map((trick) => (
              <option key={trick.id} value={trick.id}>
                {trick.name_ja} (難易度 {trick.difficulty}/10)
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {selectedTrickId && (
        <p className="mt-2 text-sm text-gray-400">
          {TRICKS.find((t) => t.id === selectedTrickId)?.description_ja}
        </p>
      )}
    </div>
  );
}
