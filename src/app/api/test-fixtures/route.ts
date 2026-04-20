import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * GET /api/test-fixtures
 * List available test fixtures, or return a specific one via ?name=xxx.
 *
 * Debug-only endpoint — not gated because it only reads static test data.
 */

const FIXTURES_DIR = join(process.cwd(), "test-assets", "middle_split", "_fixtures");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");

  if (name) {
    // Return a specific fixture
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
    const filePath = join(FIXTURES_DIR, `${safeName}.json`);
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw);
      return NextResponse.json(data);
    } catch {
      return NextResponse.json(
        { error: `Fixture "${safeName}" not found` },
        { status: 404 },
      );
    }
  }

  // List all fixtures
  try {
    const files = await readdir(FIXTURES_DIR);
    const fixtures = files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
      .sort();
    return NextResponse.json({ fixtures });
  } catch {
    return NextResponse.json({ fixtures: [] });
  }
}
