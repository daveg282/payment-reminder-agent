import { Request, Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { CsvFileError, parseImportCsv, validateRows } from '../domain/importSchema';
import { HttpError, parseOr400 } from '../http';
import { commitImport } from '../services/importer';

const MAX_BYTES = 2 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

/** Runs multer, then parses and validates the uploaded CSV. */
async function readUpload(req: Request, res: import('express').Response) {
  await new Promise<void>((resolve, reject) =>
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        reject(new HttpError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? 'file is larger than 2 MB' : err.message));
      } else if (err) reject(err);
      else resolve();
    }),
  );
  if (!req.file) throw new HttpError(400, 'attach a CSV file in the "file" field');
  try {
    return validateRows(parseImportCsv(req.file.buffer));
  } catch (err) {
    if (err instanceof CsvFileError) throw new HttpError(400, err.message);
    throw err;
  }
}

export const importRouter = Router();

// Validates only — saves nothing.
importRouter.post('/preview', async (req, res) => {
  const { valid, errors } = await readUpload(req, res);
  res.json({ validCount: valid.length, errorCount: errors.length, valid, errors });
});

// Re-parses and re-validates the file on the server; never trusts a client-sent row list.
importRouter.post('/commit', async (req, res) => {
  const { mode } = parseOr400(z.object({ mode: z.enum(['all', 'valid_only'], { error: 'mode must be all or valid_only' }) }), req.query);
  const { valid, errors } = await readUpload(req, res);
  if (mode === 'all' && errors.length > 0) {
    res.status(422).json({ error: 'the file has errors; fix them or import valid rows only', errorCount: errors.length, errors });
    return;
  }
  const result = await commitImport(valid);
  res.json({ ...result, rowsImported: valid.length, rowsSkipped: errors.length });
});
