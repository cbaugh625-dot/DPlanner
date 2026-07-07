import { NextResponse } from "next/server";
import {
  getInstitution,
  listProgramsForInstitution,
  listStudentsForInstitution,
} from "@/lib/data";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const institution = await getInstitution(id);
    if (!institution) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }
    const [programList, studentList] = await Promise.all([
      listProgramsForInstitution(id),
      listStudentsForInstitution(id),
    ]);
    return NextResponse.json({
      institution,
      programs: programList,
      students: studentList,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
