import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProjectData {
  id: string;
  name: string;
  budgetPlanned: number;
  budgetActual: number;
  progress: number;
  startDate: string;
  endDate: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const projects: ProjectData[] = body.projects || [];

    if (projects.length === 0) {
      return NextResponse.json(
        { error: "No projects provided" },
        { status: 400 }
      );
    }

    // Prepare project data for Python script
    const projectData = {
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        budget_planned: p.budgetPlanned,
        budget_actual: p.budgetActual,
        progress: p.progress,
        start_date: p.startDate,
        end_date: p.endDate,
      })),
      generated_at: new Date().toISOString(),
    };

    // Write temp JSON file
    const tempJsonPath = path.join(process.cwd(), "temp_evm_data.json");
    await fs.writeFile(tempJsonPath, JSON.stringify(projectData, null, 2));

    // Generate output filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outputFilename = `EVM_Export_${timestamp}.xlsx`;
    const outputPath = path.join(process.cwd(), "public", "exports", outputFilename);

    // Ensure exports directory exists
    await fs.mkdir(path.join(process.cwd(), "public", "exports"), { recursive: true });

    // Run Python script
    const scriptPath = path.join(process.cwd(), "scripts", "generate_evm.py");
    const { stderr } = await execAsync(
      `python3 "${scriptPath}" --input "${tempJsonPath}" --output "${outputPath}"`,
      {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      }
    );

    // Clean up temp file
    await fs.unlink(tempJsonPath).catch(() => {});

    if (stderr && !stderr.includes("Installing")) {
      console.error("Python script stderr:", stderr);
    }

    // Check if file was created
    try {
      await fs.access(outputPath);
    } catch {
      return NextResponse.json(
        { error: "Failed to generate Excel file" },
        { status: 500 }
      );
    }

    // Return download URL
    return NextResponse.json({
      success: true,
      downloadUrl: `/exports/${outputFilename}`,
      filename: outputFilename,
    });
  } catch (error) {
    console.error("EVM export error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 }
    );
  }
}
