import type { NextConfig } from "next";
import { execSync } from "child_process";

// Inject build-time info as public env vars
function getGitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: getGitHash(),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_APP_VERSION: "0.2.0",
  },
};

export default nextConfig;
