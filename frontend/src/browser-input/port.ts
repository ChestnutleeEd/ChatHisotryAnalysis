import {
  MANIFEST_FILE_NAME,
  MAX_MANIFEST_BYTES,
  MAX_NORMALIZED_CHUNK_BYTES,
  MAX_NORMALIZED_DATASET_BYTES,
  isNormalizedChunkName,
} from "../normalized/schema";

export type BrowserSelectionFailureCode =
  | "NO_FILES_SELECTED"
  | "MANIFEST_MISSING"
  | "MANIFEST_DUPLICATE"
  | "RAW_EXPORT_UNSUPPORTED"
  | "DUPLICATE_FILE_NAME"
  | "UNEXPECTED_FILE"
  | "CHUNK_TOO_LARGE"
  | "MANIFEST_TOO_LARGE"
  | "DATASET_TOO_LARGE";

export class BrowserSelectionError extends Error {
  readonly code: BrowserSelectionFailureCode;

  constructor(code: BrowserSelectionFailureCode) {
    super(code);
    this.name = "BrowserSelectionError";
    this.code = code;
  }
}

export interface StagedBrowserCandidate {
  readonly files: readonly File[];
  readonly manifest: File;
  readonly chunks: readonly File[];
  readonly aggregateBytes: number;
}

/**
 * Metadata-only main-thread preflight. File names and sizes are used solely to
 * reject impossible candidates; the Worker independently repeats every check
 * and validates bytes. No File text or ArrayBuffer is read here.
 */
export function stageBrowserCandidate(
  selectedFiles: Iterable<File>,
): StagedBrowserCandidate {
  const files = [...selectedFiles];
  if (files.length === 0) {
    throw new BrowserSelectionError("NO_FILES_SELECTED");
  }

  const names = new Set<string>();
  let manifest: File | undefined;
  const chunks: File[] = [];
  let aggregateBytes = 0n;

  for (const file of files) {
    if (names.has(file.name)) {
      throw new BrowserSelectionError("DUPLICATE_FILE_NAME");
    }
    names.add(file.name);

    if (file.name === MANIFEST_FILE_NAME) {
      if (manifest !== undefined) {
        throw new BrowserSelectionError("MANIFEST_DUPLICATE");
      }
      if (file.size > MAX_MANIFEST_BYTES) {
        throw new BrowserSelectionError("MANIFEST_TOO_LARGE");
      }
      manifest = file;
    } else if (isNormalizedChunkName(file.name)) {
      if (file.size > MAX_NORMALIZED_CHUNK_BYTES) {
        throw new BrowserSelectionError("CHUNK_TOO_LARGE");
      }
      chunks.push(file);
    } else if (file.name.toLowerCase().endsWith(".json")) {
      throw new BrowserSelectionError("RAW_EXPORT_UNSUPPORTED");
    } else {
      throw new BrowserSelectionError("UNEXPECTED_FILE");
    }

    aggregateBytes += BigInt(file.size);
    if (aggregateBytes > BigInt(MAX_NORMALIZED_DATASET_BYTES)) {
      throw new BrowserSelectionError("DATASET_TOO_LARGE");
    }
  }

  if (manifest === undefined) {
    throw new BrowserSelectionError("MANIFEST_MISSING");
  }
  if (chunks.length === 0) {
    throw new BrowserSelectionError("MANIFEST_MISSING");
  }

  chunks.sort((left, right) => left.name.localeCompare(right.name, "en"));
  return {
    files,
    manifest,
    chunks,
    aggregateBytes: Number(aggregateBytes),
  };
}

export function filesFromDataTransfer(
  transfer: DataTransfer,
): readonly File[] {
  return [...transfer.files];
}
