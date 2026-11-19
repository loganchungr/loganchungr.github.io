/* Logbook's storage on the device (IndexedDB).
     entries  every entry, by id: its Markdown, where it lives in the repo, and whether it has changes not yet synced
     files    photos and videos: "new:<name>" for ones added here and not yet synced, "sha:<sha>" for downloaded copies,
              "thumb:<key>" for small previews
     kv       settings and the last-known list of files in the repo */
const NAME = "logbook", VERSION = 1;
let opening;

function open(){
  return opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for(const [name, opts] of [["entries", {keyPath:"id"}], ["files"], ["kv"]])
        if(!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
  });
}

function run(store, mode, fn){
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode), req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = tx.onabort = () => reject(tx.error);
  }));
}

export const idb = {
  get: (store, key) => run(store, "readonly", s => s.get(key)),
  all: store => run(store, "readonly", s => s.getAll()),
  keys: store => run(store, "readonly", s => s.getAllKeys()),
  put: (store, value, key) => run(store, "readwrite", s => key === undefined ? s.put(value) : s.put(value, key)),
  del: (store, key) => run(store, "readwrite", s => s.delete(key)),
};
