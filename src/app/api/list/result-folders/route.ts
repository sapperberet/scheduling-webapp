import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Check both the app's solver_output and the workspace-level solver_output
    const bases = [
      path.join(process.cwd(), 'solver_output'),
      path.join(process.cwd(), '..', 'solver_output'),
      // also include public/solver_output where some runs are written in dev/demo setups
      path.join(process.cwd(), 'public', 'solver_output'),
      // include demo bundled solver outputs used by the local-solver-package
      path.join(process.cwd(), 'public', 'local-solver-package', 'solver_output')
    ];

    const entriesCollections: string[] = [];
    // Gather entries from each existing base
    for (const base of bases) {
      try {
        if (fs.existsSync(base)) {
          const entries = fs.readdirSync(base, { withFileTypes: true });
          // store tuple of base and entries path for later processing
          entries.forEach(e => entriesCollections.push(path.join(base, e.name)));
        }
      } catch {
        // ignore unreadable base
      }
    }
    const seen = new Set<string>();
    const folders: Array<{ name: string; path: string; created: string; fileCount: number }> = [];

    // Helper to add a found Result_N folder
    const addResultFolder = (dirPath: string, name: string) => {
      if (seen.has(name)) return;
      const files = [] as string[];
      try {
        // count files (including nested)
        const walk = (p: string) => {
          const items = fs.readdirSync(p, { withFileTypes: true });
          for (const it of items) {
            const full = path.join(p, it.name);
            if (it.isFile()) files.push(full);
            else if (it.isDirectory()) walk(full);
          }
        };
        walk(dirPath);
      } catch {
        // ignore
      }
      const stats = fs.statSync(dirPath);
      folders.push({ name, path: dirPath, created: stats.ctime.toISOString(), fileCount: files.length });
      seen.add(name);
    };

    // Walk collected entries: if an entry path is a directory matching Result_N add it,
    // otherwise if it's a run folder, scan its subfolders for Result_N.
    for (const entryPath of entriesCollections) {
      try {
        const stat = fs.statSync(entryPath);
        const name = path.basename(entryPath);
        if (stat.isDirectory() && /^Result_\d+$/i.test(name)) {
          addResultFolder(entryPath, name);
          continue;
        }
        if (stat.isDirectory()) {
          try {
            const subs = fs.readdirSync(entryPath, { withFileTypes: true });
            for (const s of subs) {
              if (s.isDirectory() && /^Result_\d+$/i.test(s.name)) {
                addResultFolder(path.join(entryPath, s.name), s.name);
              }
            }
          } catch {
            // ignore unreadable subfolders
          }
        }
      } catch {
        // ignore invalid entryPath
      }
    }

    // Sort by numeric id desc
    folders.sort((a, b) => parseInt(b.name.split('_')[1], 10) - parseInt(a.name.split('_')[1], 10));

    return NextResponse.json({ folders });
  } catch (err) {
    console.error('Error listing result folders:', err);
    return NextResponse.json({ folders: [] }, { status: 500 });
  }
}
