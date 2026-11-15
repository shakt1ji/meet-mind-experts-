/**
 * Browser IndexedDB + memory cache for recorded audio blobs so recordings play back
 * immediately and survive navigation/retries even in Local Mode.
 */

const DB_NAME = "meetmind_audio_store_v1";
const STORE_NAME = "audio_blobs";

const memoryBlobs = new Map<string, Blob>();

function openAudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Could not open audio DB"));
  });
}

export async function saveAudioBlob(meetingId: string, blob: Blob): Promise<void> {
  memoryBlobs.set(meetingId, blob);
  try {
    const db = await openAudioDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(blob, meetingId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Memory cache still holds blob if IndexedDB fails
  }
}

export async function getAudioBlob(meetingId: string): Promise<Blob | null> {
  const inMem = memoryBlobs.get(meetingId);
  if (inMem) return inMem;
  try {
    const db = await openAudioDb();
    const result = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(meetingId);
      req.onsuccess = () => resolve((req.result as Blob | undefined) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (result) memoryBlobs.set(meetingId, result);
    return result;
  } catch {
    return null;
  }
}

export async function deleteAudioBlob(meetingId: string): Promise<void> {
  memoryBlobs.delete(meetingId);
  try {
    const db = await openAudioDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(meetingId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Ignore
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIdx = result.indexOf(",");
      if (commaIdx === -1) {
        reject(new Error("Could not encode audio clip."));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(new Error("Failed to read audio blob."));
    reader.readAsDataURL(blob);
  });
}
