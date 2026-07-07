import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { eligibilityRulesets } from "@/db/schema";

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(eligibilityRulesets)
      .orderBy(asc(eligibilityRulesets.division), asc(eligibilityRulesets.effectiveDate));
    return NextResponse.json({ rulesets: rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
