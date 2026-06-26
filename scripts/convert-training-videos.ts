/**
 * Convert raw training .webm recordings to browser-ready .mp4 files.
 *
 * Usage:
 *   npm run training:convert
 *   npx tsx scripts/convert-training-videos.ts
 *
 * Input  : onboarding-videos/outputs/raw/*.webm
 * Output : onboarding-videos/outputs/final/*.mp4
 *
 * Skips any video whose .mp4 already exists.
 * Handles recordings with no audio track gracefully.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const PROJECT_ROOT = path.resolve(new URL(import.meta.url).pathname, "../..");
const RAW_DIR   = path.join(PROJECT_ROOT, "onboarding-videos/outputs/raw");
const FINAL_DIR = path.join(PROJECT_ROOT, "onboarding-videos/outputs/final");

// Ensure output directory exists
fs.mkdirSync(FINAL_DIR, { recursive: true });

const rawFiles = fs
  .readdirSync(RAW_DIR)
  .filter((f) => f.endsWith(".webm"))
  .sort();

if (rawFiles.length === 0) {
  console.log("No .webm files found in", RAW_DIR);
  process.exit(0);
}

console.log(`Found ${rawFiles.length} raw .webm file(s) in ${RAW_DIR}\n`);

let converted = 0;
let skipped   = 0;
let failed    = 0;
const errors: string[] = [];

for (const file of rawFiles) {
  const base       = path.basename(file, ".webm");
  const inputPath  = path.join(RAW_DIR, file);
  const outputPath = path.join(FINAL_DIR, `${base}.mp4`);

  if (fs.existsSync(outputPath)) {
    console.log(`⏭  Skipping  ${file}  —  MP4 already exists`);
    skipped++;
    continue;
  }

  // Probe for audio stream
  let hasAudio = false;
  try {
    const probeOutput = execFileSync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_streams", inputPath],
      { encoding: "utf-8" },
    );
    const probe = JSON.parse(probeOutput) as { streams?: Array<{ codec_type: string }> };
    hasAudio = probe.streams?.some((s) => s.codec_type === "audio") ?? false;
  } catch {
    // ffprobe failed — assume no audio and continue
  }

  console.log(`🎬 Converting  ${file}  →  ${base}.mp4  [audio: ${hasAudio ? "yes" : "no"}]`);

  const audioArgs: string[] = hasAudio
    ? ["-c:a", "aac", "-b:a", "128k"]
    : ["-an"];

  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-i", inputPath,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "23",
        ...audioArgs,
        "-movflags", "+faststart",
        outputPath,
      ],
      { stdio: "inherit" },
    );
    console.log(`✅ Done        ${base}.mp4\n`);
    converted++;
  } catch (err: unknown) {
    console.error(`❌ Failed      ${file}`);
    errors.push(file);
    failed++;
    // Remove partial output
    if (fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
  }
}

console.log("═══════════════════════════════════════");
console.log(`  Converted : ${converted}`);
console.log(`  Skipped   : ${skipped}`);
console.log(`  Failed    : ${failed}`);
if (errors.length) console.log(`  Errors    : ${errors.join(", ")}`);
console.log("═══════════════════════════════════════");

if (failed > 0) process.exit(1);
