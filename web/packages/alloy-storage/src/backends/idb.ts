/** Minimal promise wrappers over IndexedDB — internal to alloy-storage. */

export function requestAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function openDatabase(
  name: string,
  store: string,
  idbFactory: IDBFactory
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = idbFactory.open(name, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(store)) {
        open.result.createObjectStore(store, { keyPath: 'id' });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
