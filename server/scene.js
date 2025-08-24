class Scene {
  constructor() { this.objects = new Map(); }
  upsert(obj) { this.objects.set(obj.id, obj); return obj; }
  get(id) { return this.objects.get(id); }
  remove(id) { return this.objects.delete(id); }
  snapshot() { return [...this.objects.values()]; }
}
module.exports = { Scene };
