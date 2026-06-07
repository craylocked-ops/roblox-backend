// Simple in-memory session store.
// Replace with Redis for production multi-instance deployments.

const sessions = new Map();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Prune stale sessions every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActive > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 30 * 60 * 1000);

module.exports = {
  create(id) {
    sessions.set(id, {
      id,
      history: [],
      appliedActions: [],
      storedContext: null,
      projectSummary: null,
      createdAt: Date.now(),
      lastActive: Date.now(),
    });
    return sessions.get(id);
  },

  get(id) {
    const session = sessions.get(id);
    if (session) session.lastActive = Date.now();
    return session || null;
  },

  destroy(id) {
    sessions.delete(id);
  },

  size() {
    return sessions.size;
  },
};
