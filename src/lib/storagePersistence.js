export async function getStorageStatus(requestPersistence = false) {
    const storage = navigator.storage;
    let persistent = storage?.persisted ? await storage.persisted() : null;
    if (requestPersistence && persistent === false && storage?.persist) {
        persistent = await storage.persist();
    }
    const estimate = await storage?.estimate?.() || {};
    return { persistent, usage: estimate.usage || 0, quota: estimate.quota || 0 };
}

export async function requestOfflineStorage() {
    // Browsers choose whether to grant this. A refusal must not block downloading.
    try { return await getStorageStatus(true); }
    catch { return { persistent: null, usage: 0, quota: 0 }; }
}
