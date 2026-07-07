import { NextResponse } from "next/server";
import { listInstitutions } from "@/lib/data";

export async function GET() {
  try {
    return NextResponse.json({ institutions: await listInstitutions() });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
