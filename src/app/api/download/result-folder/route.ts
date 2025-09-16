// in app/api/download/result-folder/route.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import archiver from 'archiver';
import { NextResponse } from 'next/server';
import mime from 'mime-types';

async function findResultFolder(name: string): Promise<string | null> {
  const candidates = [
    path.join(process.cwd(), 'solver_output'),
    path.join(process.cwd(), '..', 'solver_output'),
    path.join(process.cwd(), 'public', 'solver_output'),
    path.join(process.cwd(), 'public', 'local-solver-package', 'solver_output'),
  ];
  for (const base of candidates) {
    try {
      const p = path.join(base, name);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    } catch {}
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const folderName = url.searchParams.get('name');
  const fileName = url.searchParams.get('file'); // New parameter

  if (!folderName) {
    return NextResponse.json({ error: 'Missing folder name' }, { status: 400 });
  }

  const foundFolder = await findResultFolder(folderName);
  if (!foundFolder) {
    return NextResponse.json({ error: `Folder '${folderName}' not found` }, { status: 404 });
  }

  // LOGIC FOR SINGLE FILE DOWNLOAD
  if (fileName) {
    const filePath = path.join(foundFolder, fileName);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return NextResponse.json({ error: `File '${fileName}' not found in '${folderName}'` }, { status: 404 });
    }
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const contentType = mime.lookup(fileName) || 'application/octet-stream';
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      });
    } catch (err) {
      return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
    }
  }

  // FALLBACK TO ORIGINAL FOLDER ZIPPING LOGIC
  const zipPath = path.join(os.tmpdir(), `${folderName}-${Date.now()}.zip`);
  try {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(output);
    archive.directory(foundFolder, false);
    await archive.finalize();
    await new Promise<void>((res, rej) => {
      output.on('close', res);
      output.on('error', rej);
    });
    const data = fs.readFileSync(zipPath);
    return new NextResponse(data, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${folderName}.zip"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to create zip' }, { status: 500 });
  } finally {
    try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch {}
  }
}