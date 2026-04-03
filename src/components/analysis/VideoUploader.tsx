"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, Camera, X, Video, Image as ImageIcon } from "lucide-react";

interface VideoUploaderProps {
  onFileSelected: (file: File, previewUrl: string) => void;
  accept?: string;
}

export default function VideoUploader({
  onFileSelected,
  accept = "image/*,video/*",
}: VideoUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileType, setFileType] = useState<"image" | "video" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraPhotoRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");

      if (!isVideo && !isImage) {
        alert("画像または動画ファイルを選択してください");
        return;
      }

      if (file.size > 100 * 1024 * 1024) {
        alert("ファイルサイズは100MB以下にしてください");
        return;
      }

      const url = URL.createObjectURL(file);
      setPreview(url);
      setFileType(isVideo ? "video" : "image");
      onFileSelected(file, url);
    },
    [onFileSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const clearPreview = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFileType(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraPhotoRef.current) cameraPhotoRef.current.value = "";
    if (cameraVideoRef.current) cameraVideoRef.current.value = "";
  };

  return (
    <div className="w-full">
      {!preview ? (
        <div className="space-y-3">
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`
              relative border-2 border-dashed rounded-xl p-6
              flex flex-col items-center justify-center gap-3
              cursor-pointer transition-all duration-200
              min-h-[200px]
              ${
                isDragging
                  ? "border-green-400 bg-green-400/10"
                  : "border-gray-600 hover:border-gray-400 bg-gray-900/50"
              }
            `}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="flex gap-3">
              <div className="p-2.5 rounded-full bg-green-500/20">
                <Video className="w-6 h-6 text-green-400" />
              </div>
              <div className="p-2.5 rounded-full bg-blue-500/20">
                <ImageIcon className="w-6 h-6 text-blue-400" />
              </div>
            </div>

            <div className="text-center">
              <p className="text-base font-medium text-gray-200">
                動画または写真をドラッグ＆ドロップ
              </p>
              <p className="text-sm text-gray-400 mt-1">
                またはタップしてライブラリから選択
              </p>
              <p className="text-xs text-gray-500 mt-2">
                MP4, MOV, WebM, JPG, PNG (最大100MB / 動画60秒以内推奨)
              </p>
            </div>

            {/* Hidden file input for library selection */}
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={handleInputChange}
            />
          </div>

          {/* Camera buttons - shown prominently for mobile */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className="flex items-center justify-center gap-2 px-4 py-3.5 bg-green-600 hover:bg-green-500 active:bg-green-700 rounded-xl text-sm font-semibold text-white transition-colors"
              onClick={() => cameraVideoRef.current?.click()}
            >
              <Video className="w-5 h-5" />
              動画を撮影
            </button>
            <button
              type="button"
              className="flex items-center justify-center gap-2 px-4 py-3.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 rounded-xl text-sm font-semibold text-white transition-colors"
              onClick={() => cameraPhotoRef.current?.click()}
            >
              <Camera className="w-5 h-5" />
              写真を撮影
            </button>
          </div>

          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 rounded-xl text-sm text-gray-300 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4" />
            ライブラリから選択
          </button>

          {/* Hidden camera inputs */}
          {/* capture="environment" uses rear camera (good for filming yourself with a tripod or having someone film you) */}
          <input
            ref={cameraVideoRef}
            type="file"
            accept="video/*"
            capture="environment"
            className="hidden"
            onChange={handleInputChange}
          />
          <input
            ref={cameraPhotoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleInputChange}
          />
        </div>
      ) : (
        <div className="relative rounded-xl overflow-hidden bg-gray-900">
          <button
            onClick={clearPreview}
            className="absolute top-3 right-3 z-10 p-2.5 bg-black/60 hover:bg-black/80 active:bg-black rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>

          {fileType === "video" ? (
            <video
              src={preview}
              controls
              playsInline
              className="w-full max-h-[500px] object-contain"
              id="uploaded-video"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="Uploaded"
              className="w-full max-h-[500px] object-contain"
              id="uploaded-image"
            />
          )}

          <div className="p-3 bg-gray-900/80 text-center">
            <button
              onClick={clearPreview}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              別のファイルを選択
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
