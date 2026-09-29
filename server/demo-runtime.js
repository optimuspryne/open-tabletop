// Single-process owner of demo occupancy, credential closure and safe reclamation.
export function createDemoRuntime({ demo, writers, roomAccess, logger = console }) {
  let sweeping = null;
  async function run() {
    for (const id of await demo.activeRooms()) {
      const room = writers.get(id);
      await demo.setOccupied(id, !!room?.state?.players?.size);
    }
    for (const { roomId } of await demo.closeExpired()) {
      const room = writers.get(roomId);
      if (room) {
        roomAccess.dispose(room); // revoke and cancel reconnects before disconnect/disposal
        room.broadcast('demoExpired');
        await room.disconnect();
      }
      // The actual writer registry remains authoritative through asynchronous final saves.
      if (!writers.has(roomId))
        await demo.purgeClosed(roomId, { canPurge: (id) => !writers.has(id) });
    }
    await demo.purgeOrphans();
  }
  function sweep() {
    if (!sweeping)
      sweeping = run().finally(() => {
        sweeping = null;
      });
    return sweeping;
  }
  return {
    sweep,
    async start() {
      await demo.recoverOccupancy();
      await sweep(); // fail startup before serving if cleanup cannot establish a safe state
      const timer = setInterval(
        () => void sweep().catch(() => logger.error('[demo] cleanup failed; will retry')),
        5000,
      );
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}
