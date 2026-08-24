export class ResourceBag {
  private readonly closers: Array<() => void | Promise<void>> = [];

  add(closer: () => void | Promise<void>) {
    this.closers.push(closer);
  }

  async close() {
    const errors: unknown[] = [];
    for (const closer of this.closers.reverse()) {
      try {
        await closer();
      } catch (error) {
        errors.push(error);
      }
    }
    this.closers.length = 0;
    if (errors.length > 0) {
      throw errors[0];
    }
  }
}
