// LibreOffice-headless conversion: any supported office/HWP document → PDF.
//
// Each job runs soffice with its own throwaway user-profile dir so jobs can run
// concurrently without clashing on a shared profile. Input/output live in a
// unique temp dir that is always cleaned up.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';

/** Extensions LibreOffice can import and that we route through it. */
export const CONVERTIBLE = new Set(['doc', 'ppt', 'docx', 'xlsx', 'pptx', 'hwp', 'hwpx', 'xls', 'rtf', 'odt', 'ods', 'odp']);

/**
 * Convert a document to PDF bytes.
 * @param {Uint8Array|Buffer} bytes
 * @param {string} filename  original name (its extension picks the import filter)
 * @param {{ sofficePath?: string, timeoutMs?: number, extraArgs?: string[] }} [opts]
 * @returns {Promise<Buffer>} PDF bytes
 */
export async function convertToPdf(bytes, filename, opts = {}) {
  const soffice = opts.sofficePath || process.env.SOFFICE_PATH || 'soffice';
  const timeoutMs = opts.timeoutMs || 120000;

  const safeExt = (extname(filename || '').replace('.', '') || 'bin').toLowerCase();
  const work = await mkdtemp(join(tmpdir(), 'mv-convert-'));
  const profile = join(work, 'profile');
  const inPath = join(work, `input.${safeExt}`);

  try {
    await writeFile(inPath, bytes);
    const args = [
      '--headless',
      '--nologo',
      '--nofirststartwizard',
      '--norestore',
      `-env:UserInstallation=file://${profile}`,
      ...(opts.extraArgs || []),
      '--convert-to',
      'pdf',
      '--outdir',
      work,
      inPath,
    ];

    await runProcess(soffice, args, timeoutMs);

    // soffice names the output after the input basename.
    const produced = join(work, `${basename(inPath, `.${safeExt}`)}.pdf`);
    let pdf;
    try {
      pdf = await readFile(produced);
    } catch {
      // Fallback: pick any .pdf that landed in the work dir.
      const files = await readdir(work);
      const anyPdf = files.find((f) => f.toLowerCase().endsWith('.pdf'));
      if (!anyPdf) throw new Error('conversion produced no PDF');
      pdf = await readFile(join(work, anyPdf));
    }
    if (!pdf || pdf.length < 5 || pdf.subarray(0, 4).toString('latin1') !== '%PDF') {
      throw new Error('conversion output is not a valid PDF');
    }
    return pdf;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

function runProcess(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`conversion timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`failed to spawn ${cmd}: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // soffice sometimes exits 0 while printing an error; the caller validates
      // the PDF bytes, so only reject here on a non-zero exit.
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim().slice(0, 300)}`));
    });
  });
}

/** Probe whether the converter binary is usable; returns a version or null. */
export async function probeSoffice(sofficePath) {
  const soffice = sofficePath || process.env.SOFFICE_PATH || 'soffice';
  return new Promise((resolve) => {
    const child = spawn(soffice, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out.trim().split('\n')[0] : null));
  });
}
